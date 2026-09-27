/**
 * Market data service.
 * Historical OHLCV  → TwelveData free API (set TWELVEDATA_API_KEY in .env)
 * Live current price → CBOE delayed quote (no auth needed)
 * Options           → CBOE delayed quotes (no auth needed)
 */
const axios = require('axios');
const db = require('../db/database');

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

// ── Persistent history cache (SQLite) ───────────────────────────────────────
// Survives server restarts (nodemon restarts wipe the in-memory cache and
// previously caused a burst of TwelveData calls → 429s on the free tier).
const histGet = db.prepare(
  'SELECT candles, fetched_at FROM history_cache WHERE symbol = ? AND interval = ?'
);
const histPut = db.prepare(
  `INSERT INTO history_cache (symbol, interval, candles, fetched_at)
   VALUES (?, ?, ?, ?)
   ON CONFLICT(symbol, interval) DO UPDATE
   SET candles = excluded.candles, fetched_at = excluded.fetched_at`
);

// ── Simple in-memory cache ──────────────────────────────────────────────────
const cache = new Map();
function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.exp) { cache.delete(key); return null; }
  return entry.data;
}
function cacheSet(key, data, ttlMs) {
  cache.set(key, { data, exp: Date.now() + ttlMs });
}

function isMarketHours() {
  const etMs = Date.now() - (4 * 3600 * 1000); // rough UTC-4 (EDT)
  const et   = new Date(etMs);
  const mins = et.getUTCHours() * 60 + et.getUTCMinutes();
  const isWeekday = et.getUTCDay() >= 1 && et.getUTCDay() <= 5;
  return isWeekday && mins >= 9 * 60 + 30 && mins < 16 * 60;
}

// Shift epoch ms so a Date's UTC fields read as Eastern time (rough UTC-4,
// same approximation as isMarketHours).
const ET_OFFSET_MS = 4 * 3600 * 1000;
function isWeekendET(ms) {
  const day = new Date(ms - ET_OFFSET_MS).getUTCDay();
  return day === 0 || day === 6;
}

// Most recent weekday 16:00 ET close at or before `now`, as epoch ms.
// (Exchange holidays aren't modeled; they only cost one extra refetch.)
function lastMarketCloseMs(now = Date.now()) {
  const et = new Date(now - ET_OFFSET_MS);
  let close = Date.UTC(et.getUTCFullYear(), et.getUTCMonth(), et.getUTCDate(), 16, 0) + ET_OFFSET_MS;
  while (close > now || isWeekendET(close)) close -= 86400 * 1000;
  return close;
}

// TwelveData free tier: 8 req/min, 800 req/day — cache aggressively.
// Market open: bars change intraday, so refresh every 15 min.
// Market closed: daily bars can't change until the next open, so a copy
// fetched after the last close (plus settling grace) stays valid all night
// and all weekend instead of being refetched hourly.
const HISTORY_OPEN_TTL = 15 * 60 * 1000;
const CLOSE_SETTLE_MS  = 15 * 60 * 1000;
function isHistoryFresh(fetchedAt) {
  if (isMarketHours()) return Date.now() - fetchedAt < HISTORY_OPEN_TTL;
  return fetchedAt >= lastMarketCloseMs() + CLOSE_SETTLE_MS;
}

// Live quote TTL: short during market hours so intraday prices stay fresh.
function quoteTTL() {
  return isMarketHours()
    ? 90 * 1000        // 90 s during market hours
    : 15 * 60 * 1000;  // 15 min outside market hours
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── TwelveData interval mapping ───────────────────────────────────────────────
const TD_INTERVAL = { '1d': '1day', '1wk': '1week', '1mo': '1month' };

// ── TwelveData request throttle ───────────────────────────────────────────────
// Free tier allows 8 req/min. Space actual network calls ≥8s apart so a
// cold-cache watchlist scan queues instead of tripping 429s. Cache hits
// never touch the queue.
const TD_SPACING_MS = 8000;
let _tdQueue = Promise.resolve();
let _tdLastCall = 0;
function tdThrottled(fn) {
  const run = _tdQueue.then(async () => {
    const wait = _tdLastCall + TD_SPACING_MS - Date.now();
    if (wait > 0) await sleep(wait);
    _tdLastCall = Date.now();
    return fn();
  });
  _tdQueue = run.catch(() => {}); // keep the chain alive after failures
  return run;
}

const _tdInflight = new Map(); // dedupe concurrent fetches per symbol/interval

// ── TwelveData history fetch ──────────────────────────────────────────────────
// Full (unfiltered) candle sets are stored in SQLite per symbol+interval.
//   fresh cache  → serve it.
//   stale cache  → serve it immediately and refresh in the background
//                  (stale-while-revalidate), so pages never wait behind the
//                  8 s/request throttle once a symbol has been fetched. The
//                  live quote overlays the current price, so slightly older
//                  bars don't change what the user sees.
//   no cache     → fetch and wait (first-ever load of a symbol).
async function fetchTwelveData(symbol, interval, fromUnix) {
  const apiKey = process.env.TWELVEDATA_API_KEY;
  if (!apiKey) throw new Error('TWELVEDATA_API_KEY not set in .env');

  const tdInterval = TD_INTERVAL[interval] || '1day';
  const fromFilter = (candles) => candles.filter(c => c.time >= fromUnix);

  const row = histGet.get(symbol, tdInterval);
  if (row && isHistoryFresh(row.fetched_at)) {
    return fromFilter(JSON.parse(row.candles));
  }

  if (row) {
    refreshTwelveData(symbol, tdInterval, apiKey).catch(e => {
      const ageMin = Math.round((Date.now() - row.fetched_at) / 60000);
      console.warn(`[history] ${symbol}: background refresh failed (${e.message}) — keeping ${ageMin} min old cache`);
    });
    return fromFilter(JSON.parse(row.candles));
  }

  return fromFilter(await refreshTwelveData(symbol, tdInterval, apiKey));
}

// Throttled network fetch that stores the result; concurrent callers for the
// same symbol/interval share one request.
function refreshTwelveData(symbol, tdInterval, apiKey) {
  const inflightKey = `${symbol}:${tdInterval}`;
  if (_tdInflight.has(inflightKey)) return _tdInflight.get(inflightKey);

  const fetchPromise = tdThrottled(async () => {
    // outputsize: bars needed. 2y + 280 warmup ≈ 1010 bars; use 1200 to be safe.
    const res = await axios.get('https://api.twelvedata.com/time_series', {
      params: { symbol, interval: tdInterval, outputsize: 1200, apikey: apiKey },
      headers: { 'User-Agent': UA },
      timeout: 20000,
    });

    if (res.data.status === 'error') throw new Error(`TwelveData: ${res.data.message}`);

    const values = res.data.values || [];
    // TwelveData returns newest-first; reverse to oldest-first for our indicators
    const candles = values.reverse().map(v => ({
      time:   Math.floor(new Date(v.datetime).getTime() / 1000),
      open:   parseFloat(v.open),
      high:   parseFloat(v.high),
      low:    parseFloat(v.low),
      close:  parseFloat(v.close),
      volume: parseInt(v.volume) || 0,
    })).filter(c => !isNaN(c.close) && !isNaN(c.time));

    // TwelveData occasionally returns out-of-order or duplicate bars for thinly
    // traded symbols — charts require strictly ascending unique timestamps
    candles.sort((a, b) => a.time - b.time);
    const deduped = candles.filter((c, i) => i === 0 || c.time !== candles[i - 1].time);

    if (deduped.length) histPut.run(symbol, tdInterval, JSON.stringify(deduped), Date.now());
    return deduped;
  }).finally(() => _tdInflight.delete(inflightKey));

  _tdInflight.set(inflightKey, fetchPromise);
  return fetchPromise;
}

// ── Build meta from candles (replaces Yahoo chart.meta) ─────────────────────
function buildMeta(symbol, candles) {
  if (!candles.length) return {};
  const last = candles[candles.length - 1];
  const prev = candles.length > 1 ? candles[candles.length - 2].close : last.close;

  const yearAgoTs = last.time - 365 * 86400;
  const yearCandles = candles.filter(c => c.time >= yearAgoTs);
  const last10 = candles.slice(-10);

  return {
    averageDailyVolume10Day: last10.reduce((s, c) => s + (c.volume || 0), 0) / last10.length || null,
    symbol,
    regularMarketPrice:     last.close,
    regularMarketOpen:      last.open,
    regularMarketDayHigh:   last.high,
    regularMarketDayLow:    last.low,
    regularMarketVolume:    last.volume,
    chartPreviousClose:     prev,
    fiftyTwoWeekHigh: yearCandles.length ? Math.max(...yearCandles.map(c => c.high)) : null,
    fiftyTwoWeekLow:  yearCandles.length ? Math.min(...yearCandles.map(c => c.low))  : null,
  };
}

// ── Public API ───────────────────────────────────────────────────────────────

async function getHistory(symbol, period1Unix, period2Unix, interval = '1d') {
  const candles = await fetchTwelveData(symbol, interval, period1Unix);
  if (!candles || !candles.length) throw new Error(`No data for ${symbol}`);
  const meta = buildMeta(symbol, candles);
  return { candles, meta };
}

async function getQuotes(symbols) {
  const symArr = Array.isArray(symbols)
    ? symbols
    : String(symbols).split(',').map(s => s.trim());

  const results = [];
  for (let i = 0; i < symArr.length; i++) {
    const sym = symArr[i];
    if (i > 0) await sleep(8000); // TwelveData free: 8 req/min → 7.5s between calls
    try {
      const now = Math.floor(Date.now() / 1000);
      const from = now - 366 * 86400;
      const { candles, meta } = await getHistory(sym, from, now, '1d');
      if (!candles.length) continue;
      const price = meta.regularMarketPrice;
      const prev  = meta.chartPreviousClose;
      results.push({
        symbol:                     sym,
        regularMarketPrice:         price,
        regularMarketChange:        price - prev,
        regularMarketChangePercent: prev ? ((price - prev) / prev) * 100 : 0,
        regularMarketVolume:        meta.regularMarketVolume,
        regularMarketOpen:          meta.regularMarketOpen,
        regularMarketDayHigh:       meta.regularMarketDayHigh,
        regularMarketDayLow:        meta.regularMarketDayLow,
        averageDailyVolume10Day:    null,
        fiftyTwoWeekHigh:           meta.fiftyTwoWeekHigh,
        fiftyTwoWeekLow:            meta.fiftyTwoWeekLow,
      });
    } catch (e) {
      console.error(`[Quotes] ${sym}:`, e.message);
    }
  }
  return results;
}

// ── Live intraday quote ───────────────────────────────────────────────────────
// Primary  : Yahoo Finance v8 quote — one batched call for many symbols, carries
//            a real `regularMarketTime`, continuously updated during the session.
// Fallback : CBOE delayed quote (per symbol, no auth).
// Every quote carries `tradeTime` (unix seconds of the last print) so callers can
// reject a stale feed: some providers freeze a symbol's quote for days (e.g. MU
// stuck on a two-day-old print), which must not override the fresh daily close.

// Parse a naive datetime string (e.g. "2026-09-22T15:59:59", exchange time, no
// zone) to unix seconds. Downstream comparisons are day-granularity, so treating
// it as UTC is close enough to tell a same-day quote from a days-old one.
function parseTradeTime(s) {
  if (!s) return null;
  const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s + 'Z';
  const t = Date.parse(iso);
  return isNaN(t) ? null : Math.floor(t / 1000);
}

// Batched Yahoo quote — reuses the cookie+crumb session used for fundamentals.
// Best-effort: returns {} on any failure so callers fall back to CBOE / candles.
async function fetchYahooQuotes(symbols) {
  const out = {};
  if (!symbols.length) return out;
  const session = await getYFSession();
  if (!session) return out;
  try {
    const res = await axios.get('https://query1.finance.yahoo.com/v8/finance/quote', {
      params: { symbols: symbols.join(','), crumb: session.crumb },
      headers: { 'User-Agent': UA, 'Accept': 'application/json', 'Cookie': session.cookie },
      timeout: 10000,
    });
    for (const x of res.data?.quoteResponse?.result || []) {
      const price = x.regularMarketPrice;
      if (price == null || isNaN(price)) continue;
      const tradeTime = x.regularMarketTime ?? null;
      const dt = tradeTime ? new Date(tradeTime * 1000) : null;
      out[x.symbol] = {
        price,
        open:        x.regularMarketOpen ?? null,
        high:        x.regularMarketDayHigh ?? null,
        low:         x.regularMarketDayLow ?? null,
        volume:      x.regularMarketVolume ?? 0,
        prevClose:   x.regularMarketPreviousClose ?? null,
        tradeTime,
        marketState: x.marketState ?? null,
        date:        dt ? dt.toISOString().slice(0, 10) : null,
        time:        dt ? dt.toISOString().slice(11, 19) : null,
        source:      'yahoo',
        updatedAt:   Date.now(),
      };
    }
  } catch (e) {
    if ([401, 403].includes(e.response?.status)) _yfSession = null; // force re-auth
    console.error('[Yahoo quote]', e.response?.status || '', e.message);
  }
  return out;
}

// CBOE single-symbol delayed quote — fallback source.
async function fetchCboeQuote(sym) {
  try {
    const res = await axios.get(
      `https://cdn.cboe.com/api/global/delayed_quotes/quotes/${encodeURIComponent(sym)}.json`,
      { headers: { 'User-Agent': UA, 'Accept': 'application/json' }, timeout: 10000 }
    );
    const d = res.data?.data;
    const price = d?.current_price;
    if (price == null || isNaN(price)) return null;
    const [date, time] = String(d.last_trade_time || '').split('T');
    return {
      price,
      open:      d.open ?? null,
      high:      d.high ?? null,
      low:       d.low ?? null,
      volume:    d.volume ?? 0,
      prevClose: d.prev_day_close ?? null,
      tradeTime: parseTradeTime(d.last_trade_time),
      date:      date || null,
      time:      time || null,
      source:    'cboe',
      updatedAt: Date.now(),
    };
  } catch (e) {
    console.error(`[CBOE quote] ${sym}:`, e.message);
    return null;
  }
}

// Prefetch quotes for a whole watchlist in one Yahoo call, warming the cache so
// subsequent per-symbol getLiveQuote() calls are instant (avoids the slow
// sequential per-symbol fetches). Symbols Yahoo omits are left for CBOE.
async function primeQuotes(symbols) {
  const syms = [...new Set(symbols.map(s => s.toUpperCase()))];
  const missing = syms.filter(s => !cacheGet(`liveq:${s}`));
  if (!missing.length) return;
  const yahoo = await fetchYahooQuotes(missing);
  for (const s of missing) {
    if (yahoo[s]) cacheSet(`liveq:${s}`, yahoo[s], quoteTTL());
  }
}

async function getLiveQuote(symbol) {
  const sym = symbol.toUpperCase();
  const key = `liveq:${sym}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  // Yahoo first (fresh timestamp), then CBOE
  let quote = (await fetchYahooQuotes([sym]))[sym] || null;
  if (!quote) quote = await fetchCboeQuote(sym);
  if (quote) cacheSet(key, quote, quoteTTL()); // 90s market hours, 15min outside
  return quote;
}

// ── Options via CBOE free public API (no auth, all expirations in one call) ───
// https://cdn.cboe.com/api/global/delayed_quotes/options/{SYMBOL}.json
const OPTIONS_TTL  = 10 * 60 * 1000;
const _optInflight = new Map();

// OCC symbol: TSLA231215C00250000  →  TSLA, 2023-12-15, Call, $250.00
function parseOCC(sym) {
  const m = sym.match(/^([A-Z0-9]+)(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/);
  if (!m) return null;
  const [, , yy, mm, dd, type, strikeStr] = m;
  const expMs = Date.UTC(2000 + parseInt(yy), parseInt(mm) - 1, parseInt(dd));
  return { expMs, type, strike: parseInt(strikeStr) / 1000 };
}

async function _fetchCBOEAll(symbol) {
  const allKey = `cboe:${symbol}`;
  const cached = cacheGet(allKey);
  if (cached) return cached;

  console.log(`[Options] CBOE fetch ${symbol}`);
  const r = await axios.get(
    `https://cdn.cboe.com/api/global/delayed_quotes/options/${symbol}.json`,
    { headers: { 'User-Agent': UA, 'Accept': 'application/json' }, timeout: 25000 }
  );

  const raw = r.data?.data;
  if (!raw) throw new Error('Empty CBOE response');

  const currentPrice = raw.current_price;

  const allOptions = (raw.options || []).map(opt => {
    const parsed = parseOCC(opt.option);
    if (!parsed) return null;
    const { expMs, type, strike } = parsed;
    return {
      contractSymbol:    opt.option,
      strike,
      expiration:        expMs / 1000,   // unix seconds
      expirationMs:      expMs,
      type,                              // 'C' or 'P'
      lastPrice:         opt.last_trade_price ?? null,
      bid:               opt.bid              ?? null,
      ask:               opt.ask              ?? null,
      volume:            opt.volume           ?? null,
      openInterest:      opt.open_interest    ?? null,
      impliedVolatility: opt.iv               ?? null,
      delta:             opt.delta            ?? null,
      gamma:             opt.gamma            ?? null,
      theta:             opt.theta            ?? null,
      vega:              opt.vega             ?? null,
      inTheMoney:        type === 'C' ? strike < currentPrice : strike > currentPrice,
      change:            opt.change           ?? null,
      percentChange:     opt.percent_change   ?? null,
    };
  }).filter(Boolean);

  // All unique expiration dates in ms, ascending
  const expirationDates = [...new Set(allOptions.map(o => o.expirationMs))].sort((a, b) => a - b);

  const result = { currentPrice, allOptions, expirationDates };
  cacheSet(allKey, result, OPTIONS_TTL);
  return result;
}

async function getOptions(symbol, dateUnix) {
  const key = `options:${symbol}:${dateUnix || 0}`;
  const cached = cacheGet(key);
  if (cached) return cached;
  if (_optInflight.has(key)) return _optInflight.get(key);

  const promise = (async () => {
    try {
      const all = await _fetchCBOEAll(symbol);
      if (!all) return null;

      const { currentPrice, allOptions, expirationDates } = all;

      // Pick target expiration
      let targetMs;
      if (dateUnix) {
        const reqMs = dateUnix * 1000;
        // Find exact or nearest date within ±1 day
        targetMs = expirationDates.find(d => Math.abs(d - reqMs) < 36 * 3600 * 1000)
                   ?? expirationDates[0];
      } else {
        targetMs = expirationDates[0];
      }

      const slice   = allOptions.filter(o => o.expirationMs === targetMs);
      const calls   = slice.filter(o => o.type === 'C').sort((a, b) => a.strike - b.strike);
      const puts    = slice.filter(o => o.type === 'P').sort((a, b) => a.strike - b.strike);

      const result = {
        underlyingSymbol: symbol,
        expirationDates,                          // already in ms
        quote: { regularMarketPrice: currentPrice },
        options: [{ calls, puts }],
      };
      cacheSet(key, result, OPTIONS_TTL);
      return result;
    } catch (e) {
      console.error('[Options CBOE]', e.message);
      return null;
    } finally {
      _optInflight.delete(key);
    }
  })();

  _optInflight.set(key, promise);
  return promise;
}

// ── Fundamentals via Yahoo Finance v8/finance/quote ───────────────────────────
// One batch request for ALL symbols → PEG, P/E, EPS, margins, etc.
// Uses cookie+crumb auth (same approach as yahoo-finance2 but crash-safe).
// Uses zero TwelveData credits. Cached 4 h per symbol.
const FUNDAMENTALS_TTL = 4 * 60 * 60 * 1000;

// YF cookie/crumb — refreshed every 30 min
let _yfSession = null;        // { cookie, crumb, at }
let _yfSessionFailUntil = 0;  // wall-clock ms; skip network session fetches until then
let _yfSessionInflight = null; // shared promise while a refresh is in progress

// Back off after a failed session fetch so one 429 doesn't trigger a retry storm
// (Yahoo answers a burst of retries with more 429s). Longer cooldown for 429.
const YF_FAIL_COOLDOWN    = 5 * 60 * 1000;   // generic failure: 5 min
const YF_RATELIMIT_COOLDOWN = 15 * 60 * 1000; // HTTP 429: 15 min

async function getYFSession() {
  const now = Date.now();
  if (_yfSession && (now - _yfSession.at) < 30 * 60 * 1000) return _yfSession;
  if (now < _yfSessionFailUntil) return null;   // in cooldown after a recent failure
  if (_yfSessionInflight) return _yfSessionInflight; // a refresh is already running

  _yfSessionInflight = (async () => {
    try {
      // Step 1: visit finance.yahoo.com to pick up cookies
      const r1 = await axios.get('https://finance.yahoo.com/', {
        headers: { 'User-Agent': UA, 'Accept': 'text/html' },
        timeout: 10000, maxRedirects: 5,
      });
      const rawCookies = r1.headers['set-cookie'] || [];
      const cookie = rawCookies.map(c => c.split(';')[0]).join('; ');

      // Step 2: fetch crumb using those cookies
      const r2 = await axios.get('https://query2.finance.yahoo.com/v1/test/getcrumb', {
        headers: { 'User-Agent': UA, 'Cookie': cookie },
        timeout: 8000,
      });
      const crumb = typeof r2.data === 'string' ? r2.data.trim() : null;
      if (!crumb) throw new Error('empty crumb');

      _yfSession = { cookie, crumb, at: Date.now() };
      _yfSessionFailUntil = 0;
      console.log('[Fundamentals] YF session refreshed, crumb:', crumb.slice(0, 6) + '…');
      return _yfSession;
    } catch (e) {
      const status = e.response?.status;
      const cooldown = status === 429 ? YF_RATELIMIT_COOLDOWN : YF_FAIL_COOLDOWN;
      _yfSessionFailUntil = Date.now() + cooldown;
      console.error(`[Fundamentals] YF session error: ${e.message} — backing off ${Math.round(cooldown / 60000)} min`);
      return null;
    } finally {
      _yfSessionInflight = null;
    }
  })();

  return _yfSessionInflight;
}

function n(v) {
  if (v == null || v === '' || (typeof v === 'number' && !isFinite(v))) return null;
  const f = parseFloat(v);
  return isNaN(f) ? null : f;
}

async function getFundamentalsBatch(symbols) {
  // Serve cached symbols immediately; only fetch the rest
  const results = [];
  const toFetch = [];
  for (const sym of symbols) {
    const hit = cacheGet(`fundamentals:${sym}`);
    if (hit) results.push(hit);
    else toFetch.push(sym);
  }
  if (!toFetch.length) return results;

  try {
    console.log(`[Fundamentals] fetching ${toFetch.join(',')}`);

    const session = await getYFSession();
    const headers = {
      'User-Agent': UA,
      'Accept': 'application/json',
      'Accept-Language': 'en-US,en;q=0.9',
    };
    if (session?.cookie) headers['Cookie'] = session.cookie;

    const params = { symbols: toFetch.join(',') };
    if (session?.crumb) params.crumb = session.crumb;

    const res = await axios.get('https://query2.finance.yahoo.com/v8/finance/quote', {
      params,
      headers,
      timeout: 15000,
    });

    const quotes = res.data?.quoteResponse?.result || [];
    for (const q of quotes) {
      const sym = q.symbol;
      if (!sym) continue;
      const data = {
        symbol:                  sym,
        pegRatio:                n(q.trailingPegRatio),
        trailingPE:              n(q.trailingPE),
        forwardPE:               n(q.forwardPE),
        priceToBook:             n(q.priceToBook),
        evToEbitda:              null,
        trailingEps:             n(q.epsTrailingTwelveMonths),
        forwardEps:              n(q.epsForward),
        earningsGrowth:          n(q.earningsGrowth),
        revenueGrowth:           n(q.revenueGrowth),
        earningsQuarterlyGrowth: n(q.earningsQuarterlyGrowth),
        marketCap:               n(q.marketCap),
        returnOnEquity:          n(q.returnOnEquity),
        profitMargin:            n(q.profitMargins),
        debtToEquity:            n(q.debtToEquity),
      };
      cacheSet(`fundamentals:${sym}`, data, FUNDAMENTALS_TTL);
      results.push(data);
    }

    if (!quotes.length) {
      // Session may be stale — force refresh next call
      _yfSession = null;
      console.error('[Fundamentals] empty response — session invalidated for retry');
    }
  } catch (e) {
    _yfSession = null; // force re-auth on next attempt
    console.error('[Fundamentals batch]', e.message);
  }

  return results;
}

// A live quote is trustworthy only if its last print is no older than the most
// recent daily bar. A provider that freezes a symbol's quote for days returns a
// tradeTime before the latest candle → rejected, so callers use the fresh close.
function isQuoteFresh(quote, latestCandleTime) {
  if (!quote || quote.tradeTime == null || !latestCandleTime) return false;
  return quote.tradeTime >= latestCandleTime;
}

module.exports = {
  getQuotes, getHistory, getOptions, getLiveQuote, getFundamentalsBatch,
  primeQuotes, isQuoteFresh,
};

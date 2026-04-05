/**
 * Market data service.
 * Historical OHLCV  → TwelveData free API (set TWELVEDATA_API_KEY in .env)
 * Live current price → Stooq /q/l/ real-time quote (no auth needed)
 * Options           → CBOE delayed quotes (no auth needed)
 */
const axios = require('axios');

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

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

// TwelveData free tier: 8 req/min, 800 req/day.
// Cache aggressively to stay well within limits.
// History TTL: 15 min during market hours, 60 min outside.
function historyTTL() {
  const now  = new Date();
  const day  = now.getUTCDay();
  const etMs = now.getTime() - (4 * 3600 * 1000); // rough UTC-4 (EDT)
  const et   = new Date(etMs);
  const mins = et.getUTCHours() * 60 + et.getUTCMinutes();
  const isWeekday = day >= 1 && day <= 5;
  const isMarketHours = mins >= 9 * 60 + 30 && mins < 16 * 60;
  return isWeekday && isMarketHours
    ? 15 * 60 * 1000   // 15 min during market hours
    : 60 * 60 * 1000;  // 60 min outside market hours
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── TwelveData interval mapping ───────────────────────────────────────────────
const TD_INTERVAL = { '1d': '1day', '1wk': '1week', '1mo': '1month' };

function toStooqSymbol(symbol) {
  return symbol.toLowerCase().replace('^', '') + '.us';
}

// ── TwelveData history fetch ──────────────────────────────────────────────────
async function fetchTwelveData(symbol, interval, fromUnix) {
  const apiKey = process.env.TWELVEDATA_API_KEY;
  if (!apiKey) throw new Error('TWELVEDATA_API_KEY not set in .env');

  const tdInterval = TD_INTERVAL[interval] || '1day';
  // outputsize: bars needed. 2y + 280 warmup ≈ 1010 bars; use 1200 to be safe.
  const outputsize = 1200;
  const key = `td:${symbol}:${tdInterval}:${new Date().toISOString().slice(0, 10)}`;

  const cached = cacheGet(key);
  if (cached) return cached;

  const res = await axios.get('https://api.twelvedata.com/time_series', {
    params: { symbol, interval: tdInterval, outputsize, apikey: apiKey },
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
  })).filter(c => !isNaN(c.close));

  // Filter to requested start date
  const filtered = candles.filter(c => c.time >= fromUnix);
  if (filtered.length) cacheSet(key, filtered, historyTTL());
  return filtered;
}

// ── Build meta from candles (replaces Yahoo chart.meta) ─────────────────────
function buildMeta(symbol, candles) {
  if (!candles.length) return {};
  const last = candles[candles.length - 1];
  const prev = candles.length > 1 ? candles[candles.length - 2].close : last.close;

  const yearAgoTs = last.time - 365 * 86400;
  const yearCandles = candles.filter(c => c.time >= yearAgoTs);

  return {
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
      console.error(`[Stooq] quote ${sym}:`, e.message);
    }
  }
  return results;
}

// ── Live delayed quote via Stooq quote endpoint ───────────────────────────────
// /q/l/?s={sym}.us&f=sd2t2ohlcv&h&e=csv  → returns current session data
// updated throughout the trading day (~15 min delayed), unlike daily bars
async function getStooqQuote(symbol) {
  const sym = toStooqSymbol(symbol);
  const key = `liveq:${sym}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  try {
    const res = await axios.get('https://stooq.com/q/l/', {
      params: { s: sym, f: 'sd2t2ohlcv', h: '', e: 'csv' },
      headers: { 'User-Agent': UA, 'Accept': 'text/plain' },
      timeout: 10000,
      responseType: 'text',
    });

    const lines = res.data.trim().split('\n');
    if (lines.length < 2) return null;
    // Header row: Symbol,Date,Time,Open,High,Low,Close,Volume
    const parts = lines[1].split(',');
    if (parts.length < 8) return null;
    const [, date, time, open, high, low, close, volume] = parts;
    const price = parseFloat(close);
    if (!price || isNaN(price)) return null;

    const quote = {
      price,
      open:   parseFloat(open),
      high:   parseFloat(high),
      low:    parseFloat(low),
      volume: parseInt(volume) || 0,
      date:   date?.trim(),
      time:   time?.trim(),
      updatedAt: Date.now(),
    };
    cacheSet(key, quote, historyTTL()); // 90s market hours, 15min outside
    return quote;
  } catch (e) {
    console.error(`[Stooq quote] ${symbol}:`, e.message);
    return null;
  }
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
let _yfSession = null; // { cookie, crumb, at }

async function getYFSession() {
  const now = Date.now();
  if (_yfSession && (now - _yfSession.at) < 30 * 60 * 1000) return _yfSession;

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

    _yfSession = { cookie, crumb, at: now };
    console.log('[Fundamentals] YF session refreshed, crumb:', crumb.slice(0, 6) + '…');
    return _yfSession;
  } catch (e) {
    console.error('[Fundamentals] YF session error:', e.message);
    return null;
  }
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

module.exports = { getQuotes, getHistory, getOptions, getStooqQuote, getFundamentalsBatch };

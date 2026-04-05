'use strict';

/**
 * SEC EDGAR fundamentals service.
 *
 * Data source: https://data.sec.gov  (free, no API key, official filings)
 *
 * Flow:
 *  1. Resolve ticker → CIK via company_tickers.json
 *  2. Fetch all XBRL company facts (companyfacts endpoint)
 *  3. Derive TTM EPS, revenue, net income, equity, debt, shares
 *  4. Calculate P/E, PEG, profit margin, ROE, D/E, P/B, market cap
 *
 * Rate limit: SEC allows up to 10 req/s per IP — very generous.
 * Cache: 7 days per symbol in SQLite (fundamentals only change on new 10-Q/10-K).
 *        Also kept in-memory for fast same-session access.
 */

const axios = require('axios');
const db    = require('../db/database');

const SEC_UA   = 'StockApp/1.0 (contact@example.com)'; // SEC requires a descriptive User-Agent
const SEC_BASE = 'https://data.sec.gov';

// ── TTL constants ─────────────────────────────────────────────────────────────
const FUND_TTL   = 30 * 24 * 60 * 60 * 1000; // 30 days — earnings only change quarterly
const TICKER_TTL = 24 * 60 * 60 * 1000;       // 24 h for ticker→CIK map
const FAIL_TTL   = 60 * 60 * 1000;            // 1 h for failed lookups (404, no XBRL)

// ── In-memory cache (fast same-session access) ────────────────────────────────
const memCache = new Map();
function memGet(key) {
  const e = memCache.get(key);
  if (!e) return undefined;
  if (Date.now() > e.exp) { memCache.delete(key); return undefined; }
  return e.data;
}
function memSet(key, data, ttlMs) {
  memCache.set(key, { data, exp: Date.now() + ttlMs });
}

// ── SQLite persistent cache (survives restarts) ───────────────────────────────
// Stores the calculated fundamentals object as JSON with an expiry timestamp.
// Price-based ratios (P/E, PEG, P/B, mktCap) are recalculated from the stored
// EPS + balance-sheet data using the current price so they stay fresh.
const _stmtGet = db.prepare(
  'SELECT data, expires_at FROM fundamentals_cache WHERE symbol = ?'
);
const _stmtSet = db.prepare(`
  INSERT INTO fundamentals_cache (symbol, data, fetched_at, expires_at)
  VALUES (?, ?, CURRENT_TIMESTAMP, ?)
  ON CONFLICT(symbol) DO UPDATE SET data=excluded.data,
    fetched_at=CURRENT_TIMESTAMP, expires_at=excluded.expires_at
`);

function dbGet(symbol) {
  try {
    const row = _stmtGet.get(symbol);
    if (!row) return undefined;
    if (Date.now() > row.expires_at) return undefined; // expired
    return JSON.parse(row.data);
  } catch { return undefined; }
}
function dbSet(symbol, data, ttlMs) {
  try {
    _stmtSet.run(symbol, JSON.stringify(data), Date.now() + ttlMs);
  } catch { /* non-critical */ }
}

// ── Combined cache helpers (mem-first, SQLite for persistence) ────────────────
// Keys for fundamentals look like 'fundamentals:AAPL'.
// SQLite stores just the symbol ('AAPL') as the primary key.
function _symbolFromKey(key) {
  return key.startsWith('fundamentals:') ? key.slice('fundamentals:'.length) : null;
}

function cacheGet(key) {
  const mem = memGet(key);
  if (mem !== undefined) return mem;
  // Only try SQLite for fundamentals keys
  const sym = _symbolFromKey(key);
  if (sym) {
    const disk = dbGet(sym);
    if (disk !== undefined) { memSet(key, disk, FUND_TTL); return disk; }
  }
  return null;
}
function cacheSet(key, data, ttlMs) {
  memSet(key, data, ttlMs);
  const sym = _symbolFromKey(key);
  if (sym && data && typeof data === 'object') {
    dbSet(sym, data, ttlMs);
  }
}

// Alias used for ticker-map (not persisted)
function cacheGetMem(key) { return memGet(key) ?? null; }
function cacheSetMem(key, data, ttlMs) { memSet(key, data, ttlMs); }

const TICKER_TTL_USED = TICKER_TTL;

// ── Ticker → CIK lookup ───────────────────────────────────────────────────────
let _tickerMap = null; // { AAPL: 320193, TSLA: 1318605, ... }

async function loadTickerMap() {
  // Ticker map is large (~12k entries), keep only in memory not SQLite
  const cached = cacheGetMem('sec:tickers');
  if (cached) return cached;

  const res = await axios.get('https://www.sec.gov/files/company_tickers.json', {
    headers: { 'User-Agent': SEC_UA },
    timeout: 15000,
  });

  const map = {};
  for (const entry of Object.values(res.data || {})) {
    if (entry.ticker) map[entry.ticker.toUpperCase()] = entry.cik_str;
  }
  cacheSetMem('sec:tickers', map, TICKER_TTL_USED);
  _tickerMap = map;
  return map;
}

async function getCIK(ticker) {
  const map = _tickerMap || await loadTickerMap();
  return map[ticker.toUpperCase()] ?? null;
}

// ── Fetch all XBRL facts for a company ───────────────────────────────────────
// Raw XBRL blobs are large (~2MB each). Keep in memory only during the session;
// the *derived* fundamentals are persisted in SQLite instead.
async function fetchFacts(cik) {
  const padded = String(cik).padStart(10, '0');
  const cacheKey = `sec:facts:${padded}`;
  const cached = cacheGetMem(cacheKey);
  if (cached) return cached;

  const res = await axios.get(`${SEC_BASE}/api/xbrl/companyfacts/CIK${padded}.json`, {
    headers: { 'User-Agent': SEC_UA },
    timeout: 20000,
  });

  const facts = res.data?.facts || {};
  cacheSetMem(cacheKey, facts, FUND_TTL);
  return facts;
}

// ── Period duration helper ────────────────────────────────────────────────────
// Returns number of days between start and end date strings (YYYY-MM-DD).
function durationDays(start, end) {
  if (!start || !end) return null;
  return (new Date(end) - new Date(start)) / 86400000;
}

// ── Extract TTM (trailing 12-month) value from a fact's units array ──────────
// Prefers 4 × single-quarter 10-Q filings summed; falls back to latest 10-K annual.
// IMPORTANT: EDGAR quarterly entries can be single-quarter (~91 days) OR cumulative
// YTD (e.g. 6-month or 9-month). We only want true single-quarter entries so we
// don't double-count when summing 4 quarters.
function ttmFromFact(fact, unitKey = 'USD') {
  const entries = fact?.units?.[unitKey];
  if (!entries || !entries.length) return null;

  // Keep only 10-Q entries that represent a single quarter (60–105 days)
  const quarterly = entries
    .filter(e => {
      if (e.form !== '10-Q' || !e.end || !e.start) return false;
      if (e.frame?.includes('I')) return false; // instant / balance-sheet snapshot
      const days = durationDays(e.start, e.end);
      return days != null && days >= 60 && days <= 105; // single quarter window
    })
    .sort((a, b) => b.end.localeCompare(a.end));

  // Deduplicate by end date (take first occurrence = most recent filing)
  const seen = new Set();
  const deduped = [];
  for (const e of quarterly) {
    if (!seen.has(e.end)) { seen.add(e.end); deduped.push(e); }
  }

  // Sum last 4 quarters → TTM
  const last4 = deduped.slice(0, 4);
  if (last4.length === 4) {
    return last4.reduce((s, e) => s + (e.val ?? 0), 0);
  }

  // Fallback: latest 10-K annual filing
  const annual = entries
    .filter(e => e.form === '10-K' && e.end)
    .sort((a, b) => b.end.localeCompare(a.end));
  return annual[0]?.val ?? null;
}

// For per-share values (EPS) the unit key is 'USD/shares'
function ttmEPS(fact) { return ttmFromFact(fact, 'USD/shares'); }

// Latest point-in-time balance-sheet value (most recent filing)
function latestBalance(fact, unitKey = 'USD') {
  const entries = fact?.units?.[unitKey];
  if (!entries?.length) return null;
  const relevant = entries
    .filter(e => (e.form === '10-Q' || e.form === '10-K') && e.end)
    .sort((a, b) => b.end.localeCompare(a.end));
  return relevant[0]?.val ?? null;
}

// Latest quarterly value (for growth rate calculation — compare vs year-ago)
function latestQuarter(fact, unitKey = 'USD') {
  const entries = fact?.units?.[unitKey];
  if (!entries?.length) return null;
  const q = entries
    .filter(e => {
      if (e.form !== '10-Q' || !e.end || !e.start) return false;
      if (e.frame?.includes('I')) return false;
      const days = durationDays(e.start, e.end);
      return days != null && days >= 60 && days <= 105;
    })
    .sort((a, b) => b.end.localeCompare(a.end));
  const seen = new Set();
  const deduped = [];
  for (const e of q) {
    if (!seen.has(e.end)) { seen.add(e.end); deduped.push(e); }
  }
  return deduped; // return array so caller can pick current + year-ago
}

// ── GAAP concept aliases (companies use different concept names) ─────────────
function pickFact(gaap, ...names) {
  for (const name of names) {
    if (gaap[name]) return gaap[name];
  }
  return null;
}

// Sentinel object stored in cache for symbols that have no SEC EDGAR data,
// so we don't re-hit the network on every request for the same bad ticker.
const NOT_FOUND = Object.freeze({ _notFound: true });

// ── Main: calculate fundamentals for one symbol given current price ───────────
// ── Recalculate price-dependent ratios from stored base values + current price ─
// Called on every cache hit so P/E, PEG, P/B, market cap are always live.
function applyPrice(data, price) {
  if (!price || !data._base) return data;
  const { epsTTM, earningsGrowth, equity, shares, totalDebt, cash, ebitdaTTM } = data._base;
  const trailingPE  = (epsTTM && epsTTM > 0) ? price / epsTTM : null;
  const pegRatio    = (trailingPE && earningsGrowth && earningsGrowth > 0)
                        ? trailingPE / (earningsGrowth * 100) : null;
  const priceToBook = (equity && shares && shares > 0) ? price / (equity / shares) : null;
  const marketCap   = shares ? price * shares : null;
  const ev          = marketCap != null ? marketCap + (totalDebt ?? 0) - (cash ?? 0) : null;
  const evToEbitda  = (ev != null && ebitdaTTM && ebitdaTTM > 0) ? ev / ebitdaTTM : null;
  return { ...data, trailingPE, pegRatio, priceToBook, marketCap, evToEbitda };
}

async function calcFundamentals(ticker, currentPrice) {
  const cacheKey = `fundamentals:${ticker}`;
  const cached = cacheGet(cacheKey);
  // _notFound may come from memory (object identity) or from SQLite (JSON-deserialized)
  if (cached && cached._notFound) return null;
  if (cached) {
    // Re-apply the current price so P/E, PEG, P/B, mktCap, EV/EBITDA stay fresh
    // even when the underlying SEC data is served from the 30-day cache.
    const updated = applyPrice(cached, currentPrice);
    const { _base: _b, ...pub } = updated;   // don't expose internal base to callers
    return pub;
  }

  try {
    const cik = await getCIK(ticker);
    if (!cik) {
      console.error(`[SEC] ${ticker}: CIK not found`);
      return null;
    }

    const facts = await fetchFacts(cik);
    const gaap  = facts['us-gaap'] || {};

    // ── Revenue (TTM) ──────────────────────────────────────────────────────────
    // Try multiple GAAP revenue concepts; use whichever has the most quarterly entries
    const revCandidates = [
      'Revenues',
      'RevenueFromContractWithCustomerExcludingAssessedTax',
      'SalesRevenueNet',
      'RevenueFromContractWithCustomerIncludingAssessedTax',
      'SalesRevenueGoodsNet',
      'SalesRevenueServicesNet',
    ].map(name => gaap[name]).filter(Boolean);

    // Pick the candidate whose TTM calculation yields a non-null result with the most quarters
    let revFact = null;
    let bestRevCount = 0;
    for (const candidate of revCandidates) {
      const entries = candidate?.units?.USD || [];
      const qCount = entries.filter(e => {
        if (e.form !== '10-Q' || !e.start || !e.end) return false;
        const days = durationDays(e.start, e.end);
        return days != null && days >= 60 && days <= 105;
      }).length;
      if (qCount > bestRevCount) { bestRevCount = qCount; revFact = candidate; }
    }
    const revTTM = ttmFromFact(revFact);

    // Revenue growth: most-recent quarter vs year-ago quarter
    const revQ = latestQuarter(revFact);
    let revenueGrowth = null;
    if (revQ && revQ.length >= 5) {
      const cur = revQ[0].val, ago = revQ[4].val;
      if (ago && ago !== 0) revenueGrowth = (cur - ago) / Math.abs(ago);
    }

    // ── Net Income (TTM) ───────────────────────────────────────────────────────
    const niTTM = ttmFromFact(pickFact(gaap, 'NetIncomeLoss', 'NetIncomeLossAvailableToCommonStockholdersBasic'));

    // ── EPS diluted (TTM) ──────────────────────────────────────────────────────
    const epsFact = pickFact(gaap,
      'EarningsPerShareDiluted',
      'IncomeLossFromContinuingOperationsPerDilutedShare',
    );
    let epsTTM = ttmEPS(epsFact);

    // If quarterly EPS not available, derive from net income / shares
    const sharesFact = pickFact(gaap,
      'CommonStockSharesOutstanding',
      'EntityCommonStockSharesOutstanding',
    );
    const shares = latestBalance(sharesFact, 'shares');

    if (epsTTM == null && niTTM != null && shares) {
      epsTTM = niTTM / shares;
    }

    // ── EPS growth (latest quarter vs same quarter a year ago) ─────────────────
    // Single-quarter YoY avoids stock-split mixing problems that appear when
    // combining pre- and post-split quarters in an 8-quarter TTM-to-TTM window.
    const epsQ = latestQuarter(epsFact, 'USD/shares');
    let earningsGrowth = null;
    if (epsQ && epsQ.length >= 5) {
      const cur = epsQ[0].val, ago = epsQ[4].val;
      if (ago && ago !== 0) earningsGrowth = (cur - ago) / Math.abs(ago);
    }

    // ── Balance sheet ──────────────────────────────────────────────────────────
    const equity = latestBalance(pickFact(gaap,
      'StockholdersEquity',
      'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest',
    ));

    const totalAssets = latestBalance(pickFact(gaap, 'Assets'));

    const totalDebt = (() => {
      const ltDebt = latestBalance(pickFact(gaap, 'LongTermDebt', 'LongTermDebtNoncurrent')) ?? 0;
      const stDebt = latestBalance(pickFact(gaap,
        'ShortTermBorrowings',
        'NotesPayableCurrent',
        'LongTermDebtCurrent',
        'DebtCurrent',
      )) ?? 0;
      const combined = latestBalance(pickFact(gaap, 'LongTermDebtAndCapitalLeaseObligations',
        'DebtAndCapitalLeaseObligations'));
      return combined ?? (ltDebt + stDebt);
    })();

    // ── EV / EBITDA ────────────────────────────────────────────────────────────
    // D&A from cash-flow statement (most companies file under one of these names)
    const daFact = pickFact(gaap,
      'DepreciationDepletionAndAmortization',
      'DepreciationAndAmortization',
      'Depreciation',
      'DepreciationDepletionAndAmortizationExcludingDiscontinuedOperations',
    );
    const daTTM = ttmFromFact(daFact);

    // Operating income (TTM) — EBITDA = EBIT + D&A
    const opIncFact = pickFact(gaap, 'OperatingIncomeLoss');
    const opIncTTM  = ttmFromFact(opIncFact);

    // EBITDA: prefer Operating Income + D&A; fall back to Net Income + Taxes + Interest + D&A
    let ebitdaTTM = null;
    if (opIncTTM != null && daTTM != null) {
      ebitdaTTM = opIncTTM + daTTM;
    } else if (niTTM != null && daTTM != null) {
      const taxTTM = ttmFromFact(pickFact(gaap, 'IncomeTaxExpenseBenefit')) ?? 0;
      const intTTM = ttmFromFact(pickFact(gaap,
        'InterestExpense',
        'InterestAndDebtExpense',
        'InterestExpenseDebt',
      )) ?? 0;
      ebitdaTTM = niTTM + taxTTM + Math.abs(intTTM) + daTTM;
    }

    // Cash & equivalents (subtract from EV to get enterprise value)
    const cashFact = pickFact(gaap,
      'CashAndCashEquivalentsAtCarryingValue',
      'CashCashEquivalentsAndShortTermInvestments',
      'CashAndCashEquivalentsAndShortTermInvestments',
    );
    const cash = latestBalance(cashFact) ?? 0;

    // ── Derived metrics ────────────────────────────────────────────────────────
    const price = currentPrice;

    const trailingPE   = (price && epsTTM && epsTTM > 0) ? price / epsTTM : null;
    const pegRatio     = (trailingPE && earningsGrowth && earningsGrowth > 0)
                           ? trailingPE / (earningsGrowth * 100) : null;
    const profitMargin = (niTTM != null && revTTM) ? niTTM / revTTM : null;
    const returnOnEquity = (niTTM != null && equity && equity > 0) ? niTTM / equity : null;
    const debtToEquity   = (totalDebt != null && equity && equity > 0) ? (totalDebt / equity) * 100 : null;
    const priceToBook    = (price && equity && shares && shares > 0)
                             ? price / (equity / shares) : null;
    const marketCap      = (price && shares) ? price * shares : null;
    const enterpriseValue = (marketCap != null) ? marketCap + (totalDebt ?? 0) - cash : null;
    const evToEbitda     = (enterpriseValue != null && ebitdaTTM && ebitdaTTM > 0)
                             ? enterpriseValue / ebitdaTTM : null;

    const data = {
      symbol:                  ticker,
      pegRatio,
      trailingPE,
      forwardPE:               null,   // analyst forward estimates — not in SEC filings
      priceToBook,
      evToEbitda,
      trailingEps:             epsTTM,
      forwardEps:              null,   // analyst forward estimates — not in SEC filings
      earningsGrowth,
      revenueGrowth,
      earningsQuarterlyGrowth: earningsGrowth,
      marketCap,
      returnOnEquity,
      profitMargin,
      debtToEquity,
      // _base is stored in cache for price recalculation on future cache hits,
      // but is stripped before being returned to callers.
      _base: { epsTTM, earningsGrowth, equity, shares, totalDebt, cash, ebitdaTTM },
    };

    cacheSet(cacheKey, data, FUND_TTL);
    const fmt = v => v == null ? '—' : (v > 1e9 ? `${(v/1e9).toFixed(1)}B` : v.toFixed(2));
    console.log(`[SEC] ${ticker}: P/E=${trailingPE?.toFixed(1) ?? '—'} PEG=${pegRatio?.toFixed(2) ?? '—'} EV/EBITDA=${evToEbitda?.toFixed(1) ?? '—'} EPS=${epsTTM?.toFixed(2) ?? '—'} EBITDA=${fmt(ebitdaTTM)} D&A=${fmt(daTTM)}`);
    const { _base: _b, ...pub } = data;
    return pub;
  } catch (e) {
    console.error(`[SEC] ${ticker}:`, e.message);
    // Cache the failure for 1 hour so repeat requests don't re-hit EDGAR
    cacheSet(cacheKey, NOT_FOUND, 60 * 60 * 1000);
    return null;
  }
}

// ── Batch: fetch fundamentals for all symbols, using current price from cache ─
async function getFundamentalsBatch(symbols, priceMap = {}) {
  const results = [];
  // Load ticker→CIK map once for all symbols
  await loadTickerMap().catch(() => {});

  for (let i = 0; i < symbols.length; i++) {
    const sym = symbols[i];
    const price = priceMap[sym] ?? null;
    if (i > 0) await new Promise(r => setTimeout(r, 200)); // gentle SEC pacing
    const data = await calcFundamentals(sym, price);
    if (data) results.push(data);
  }
  return results;
}

// ── Build rolling TTM time series from a XBRL fact ───────────────────────────
// Returns array sorted oldest→newest: [{ date, value, growthPct }, ...]
// Each entry = TTM value ending at that quarter's end date.
function buildTTMSeries(fact, unitKey = 'USD') {
  const entries = fact?.units?.[unitKey];
  if (!entries?.length) return [];

  const quarterly = entries
    .filter(e => {
      if (e.form !== '10-Q' || !e.end || !e.start) return false;
      if (e.frame?.includes('I')) return false;
      const days = durationDays(e.start, e.end);
      return days != null && days >= 60 && days <= 105;
    })
    .sort((a, b) => b.end.localeCompare(a.end));

  const seen = new Set();
  const deduped = [];
  for (const e of quarterly) {
    if (!seen.has(e.end)) { seen.add(e.end); deduped.push(e); }
  }

  if (deduped.length < 4) return [];

  // Rolling 4-quarter TTM windows (deduped is newest-first)
  const raw = [];
  for (let i = 0; i + 3 < deduped.length; i++) {
    const ttm = deduped.slice(i, i + 4).reduce((s, e) => s + (e.val ?? 0), 0);
    raw.push({ date: deduped[i].end, value: ttm });
  }

  // YoY growth: window i vs window i+4 (same quarter one year ago)
  for (let i = 0; i < raw.length; i++) {
    if (i + 4 < raw.length) {
      const prior = raw[i + 4].value;
      raw[i].growthPct = prior ? ((raw[i].value - prior) / Math.abs(prior)) * 100 : null;
    } else {
      raw[i].growthPct = null;
    }
  }

  return raw.reverse(); // oldest first for chart rendering
}

// ── Get 12-month moving-average series for one ticker ────────────────────────
async function getMovingAvgSeries(ticker) {
  const cacheKey = `movavg:${ticker}`;
  const cached = memGet(cacheKey);
  if (cached) return cached;

  try {
    const cik = await getCIK(ticker);
    if (!cik) return null;

    const facts = await fetchFacts(cik);
    const gaap  = facts['us-gaap'] || {};

    // Revenue — same candidate selection as calcFundamentals
    const revCandidates = [
      'Revenues',
      'RevenueFromContractWithCustomerExcludingAssessedTax',
      'SalesRevenueNet',
      'RevenueFromContractWithCustomerIncludingAssessedTax',
      'SalesRevenueGoodsNet',
      'SalesRevenueServicesNet',
    ].map(n => gaap[n]).filter(Boolean);

    let revFact = null, bestRevCount = 0;
    for (const c of revCandidates) {
      const cnt = (c?.units?.USD || []).filter(e => {
        if (e.form !== '10-Q' || !e.start || !e.end) return false;
        const days = durationDays(e.start, e.end);
        return days != null && days >= 60 && days <= 105;
      }).length;
      if (cnt > bestRevCount) { bestRevCount = cnt; revFact = c; }
    }

    const epsFact = pickFact(gaap, 'EarningsPerShareDiluted', 'IncomeLossFromContinuingOperationsPerDilutedShare');
    const niFact  = pickFact(gaap, 'NetIncomeLoss', 'NetIncomeLossAvailableToCommonStockholdersBasic');

    const epsSeries = buildTTMSeries(epsFact, 'USD/shares');
    const revSeries = buildTTMSeries(revFact, 'USD');
    const niSeries  = buildTTMSeries(niFact, 'USD');

    // Merge all three series into one date-keyed array
    const dateMap = new Map();
    for (const { date, value, growthPct } of epsSeries) {
      dateMap.set(date, { date, epsTTM: value, epsGrowthPct: growthPct });
    }
    for (const { date, value, growthPct } of revSeries) {
      const e = dateMap.get(date) || { date };
      e.revTTM      = value;
      e.revGrowthPct = growthPct;
      dateMap.set(date, e);
    }
    for (const { date, value } of niSeries) {
      const e = dateMap.get(date) || { date };
      e.niTTM     = value;
      e.marginPct = (value != null && e.revTTM) ? (value / e.revTTM) * 100 : null;
      dateMap.set(date, e);
    }

    const series = Array.from(dateMap.values()).sort((a, b) => a.date.localeCompare(b.date));
    const result = { symbol: ticker, series };

    memSet(cacheKey, result, 6 * 60 * 60 * 1000); // 6-hour in-memory cache
    return result;
  } catch (e) {
    console.error(`[SEC movavg] ${ticker}:`, e.message);
    return null;
  }
}

async function getMovingAvgBatch(symbols) {
  await loadTickerMap().catch(() => {});
  const results = [];
  for (let i = 0; i < symbols.length; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, 200));
    const data = await getMovingAvgSeries(symbols[i]);
    if (data) results.push(data);
  }
  return results;
}

module.exports = { getFundamentalsBatch, getMovingAvgBatch, loadTickerMap };

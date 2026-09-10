'use strict';

const express = require('express');
const router = express.Router();
const axios = require('axios');
const { EPISODES, computeSummary, scoreConditions } = require('../services/macroHistory');
const {
  SNAPSHOT, SCENARIOS, WHY_UNLIKELY, RAISES_RISK, LOWERS_RISK, scoreRisk,
} = require('../services/japanWatch');
const china = require('../services/chinaWatch');

// ── Static history + correlations (always available) ────────────────────────
router.get('/corrections', (req, res) => {
  res.json({ episodes: EPISODES, summary: computeSummary() });
});

// ── Present-day macro snapshot ──────────────────────────────────────────────
// Live from FRED when FRED_API_KEY is set (coverage 1954+), otherwise the
// client falls back to manual entry. Cached 6h in-memory.
const FRED = 'https://api.stlouisfed.org/fred/series/observations';
let _curCache = null; // { data, exp }

async function fredLatest(seriesId, key, limit = 1) {
  const r = await axios.get(FRED, {
    params: {
      series_id: seriesId, api_key: key, file_type: 'json',
      sort_order: 'desc', limit,
    },
    timeout: 12000,
  });
  const obs = (r.data?.observations || []).filter(o => o.value !== '.');
  return obs; // newest-first
}

router.get('/current', async (req, res) => {
  const key = process.env.FRED_API_KEY;
  if (!key) return res.json({ live: false, reason: 'no_fred_key' });

  if (_curCache && Date.now() < _curCache.exp) return res.json(_curCache.data);

  try {
    // Pull each series' latest reading (CPI/unemployment need a short history)
    const [ff, curve, cpiObs, unrateObs, hy] = await Promise.all([
      fredLatest('FEDFUNDS', key).catch(() => []),
      fredLatest('T10Y2Y', key).catch(() => []),      // 10y–2y spread, daily
      fredLatest('CPIAUCSL', key, 13).catch(() => []), // for 12-mo YoY
      fredLatest('UNRATE', key, 4).catch(() => []),    // for trend
      fredLatest('BAMLH0A0HYM2', key).catch(() => []), // HY OAS credit spread
    ]);

    const num = (o) => (o && o.value != null ? parseFloat(o.value) : null);

    // CPI YoY from index level vs ~12 months ago
    let cpiYoY = null;
    if (cpiObs.length >= 13) {
      const now = parseFloat(cpiObs[0].value);
      const yearAgo = parseFloat(cpiObs[12].value);
      if (yearAgo) cpiYoY = ((now - yearAgo) / yearAgo) * 100;
    }

    // Unemployment trend: latest vs 3 months ago
    let unemployment = num(unrateObs[0]);
    let unempRising = null;
    if (unrateObs.length >= 4) {
      unempRising = parseFloat(unrateObs[0].value) > parseFloat(unrateObs[3].value);
    }

    const cur = {
      fedFunds: num(ff[0]),
      curve: num(curve[0]),
      cpiYoY,
      unemployment,
      unempRising,
      hySpread: num(hy[0]),
      asOf: ff[0]?.date || new Date().toISOString().slice(0, 10),
    };

    const data = { live: true, current: cur, conditions: scoreConditions(cur) };
    _curCache = { data, exp: Date.now() + 6 * 60 * 60 * 1000 };
    res.json(data);
  } catch (e) {
    console.error('[macro/current]', e.message);
    res.json({ live: false, reason: 'fred_error', error: e.message });
  }
});

// ── Score a manually-entered snapshot (offline "where are we now") ──────────
router.post('/score', (req, res) => {
  const b = req.body || {};
  const cur = {
    fedFunds: b.fedFunds != null && b.fedFunds !== '' ? parseFloat(b.fedFunds) : null,
    curve: b.curve != null && b.curve !== '' ? parseFloat(b.curve) : null,
    cpiYoY: b.cpiYoY != null && b.cpiYoY !== '' ? parseFloat(b.cpiYoY) : null,
    hySpread: b.hySpread != null && b.hySpread !== '' ? parseFloat(b.hySpread) : null,
    unemployment: b.unemployment != null && b.unemployment !== '' ? parseFloat(b.unemployment) : null,
    unempRising: typeof b.unempRising === 'boolean' ? b.unempRising : null,
  };
  res.json({ current: cur, conditions: scoreConditions(cur) });
});

// ── Japan / US-Treasury watch ───────────────────────────────────────────────
// USD/JPY history + spot come from Frankfurter (ECB daily reference rates, no
// auth) so the chart works for everyone. Fed funds is overlaid from FRED when
// FRED_API_KEY is set, else the curated snapshot value is used. Cached 6h.
let _jpCache = null;

// ~2y of daily FX for `symbol` (e.g. 'JPY', 'CNY') vs USD, via Frankfurter (ECB).
async function fetchFxSeries(symbol) {
  const end = new Date();
  const start = new Date(end);
  start.setFullYear(end.getFullYear() - 2);
  const iso = (d) => d.toISOString().slice(0, 10);
  const r = await axios.get(`https://api.frankfurter.dev/v1/${iso(start)}..${iso(end)}`, {
    params: { base: 'USD', symbols: symbol }, timeout: 12000,
  });
  const rates = r.data?.rates || {};
  return Object.keys(rates).sort()
    .map(date => ({ date, value: rates[date]?.[symbol] }))
    .filter(p => p.value != null);
}

router.get('/japan', async (req, res) => {
  const framework = { scenarios: SCENARIOS, whyUnlikely: WHY_UNLIKELY, raisesRisk: RAISES_RISK, lowersRisk: LOWERS_RISK };

  if (_jpCache && Date.now() < _jpCache.exp) return res.json(_jpCache.data);

  // USD/JPY series + spot (no auth)
  let series = null, spot = null, asOf = null;
  try {
    series = await fetchFxSeries('JPY');
    if (series.length) { spot = series[series.length - 1].value; asOf = series[series.length - 1].date; }
  } catch (e) {
    console.error('[macro/japan fx]', e.message);
  }

  // Optional Fed-funds overlay from FRED
  let fedRate = null;
  const key = process.env.FRED_API_KEY;
  if (key) {
    try {
      const ff = await fredLatest('FEDFUNDS', key);
      if (ff[0]?.value != null && ff[0].value !== '.') fedRate = parseFloat(ff[0].value);
    } catch (e) { console.error('[macro/japan fred]', e.message); }
  }

  const snap = {
    ...SNAPSHOT,
    usdjpy: spot ?? SNAPSHOT.usdjpy,
    fedRate: fedRate ?? SNAPSHOT.fedRate,
    asOf: asOf || SNAPSHOT.asOf,
  };

  const data = { live: !!series?.length, snapshot: snap, risk: scoreRisk(snap), framework, series };
  if (series?.length) _jpCache = { data, exp: Date.now() + 6 * 60 * 60 * 1000 };
  res.json(data);
});

// ── China / de-dollarization watch ──────────────────────────────────────────
// Curated snapshot + gold-tonnage and Treasury-holdings series; overlays live
// USD/CNY from Frankfurter (no auth). Cached 6h.
let _cnCache = null;

router.get('/china', async (req, res) => {
  const framework = {
    pillars: china.PILLARS, whatsReal: china.WHATS_REAL,
    hardLimits: china.HARD_LIMITS, outlook: china.OUTLOOK,
  };
  const seriesData = { gold: china.GOLD_SERIES, ust: china.UST_SERIES };

  if (_cnCache && Date.now() < _cnCache.exp) return res.json(_cnCache.data);

  let usdcnySeries = null, spot = null, asOf = null;
  try {
    usdcnySeries = await fetchFxSeries('CNY');
    if (usdcnySeries.length) {
      spot = usdcnySeries[usdcnySeries.length - 1].value;
      asOf = usdcnySeries[usdcnySeries.length - 1].date;
    }
  } catch (e) {
    console.error('[macro/china fx]', e.message);
  }

  const snap = { ...china.SNAPSHOT, usdcny: spot ?? china.SNAPSHOT.usdcny, asOf: asOf || china.SNAPSHOT.asOf };
  const data = {
    live: !!usdcnySeries?.length,
    snapshot: snap,
    momentum: china.scoreMomentum(snap),
    framework,
    series: seriesData,
    usdcnySeries,
  };
  if (usdcnySeries?.length) _cnCache = { data, exp: Date.now() + 6 * 60 * 60 * 1000 };
  res.json(data);
});

// ── Latest-news feed via Google News RSS (no auth) ──────────────────────────
const NEWS_QUERIES = {
  japan: 'Japan yen intervention OR "Bank of Japan" OR "US Treasuries" Japan',
  china: 'China de-dollarization OR petroyuan OR "PBoC gold" OR yuan reserves',
};
const _newsCache = new Map(); // topic → { data, exp }

function parseNewsRss(xml, limit = 8) {
  const items = [];
  const blocks = xml.split('<item>').slice(1);
  for (const b of blocks.slice(0, limit)) {
    const pick = (tag) => {
      const m = b.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
      if (!m) return null;
      return m[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim();
    };
    let title = pick('title');
    const link = pick('link');
    const pubDate = pick('pubDate');
    const source = pick('source');
    if (!title || !link) continue;
    // Google News titles are "Headline - Source"; strip trailing source
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3));
    items.push({ title, link, pubDate, source });
  }
  return items;
}

router.get('/news', async (req, res) => {
  const topic = String(req.query.topic || '').toLowerCase();
  const query = NEWS_QUERIES[topic];
  if (!query) return res.status(400).json({ error: 'unknown topic' });

  const cached = _newsCache.get(topic);
  if (cached && Date.now() < cached.exp) return res.json(cached.data);

  try {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
    const r = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/rss+xml, application/xml, text/xml' },
      timeout: 12000, responseType: 'text',
    });
    const items = parseNewsRss(r.data);
    const data = { topic, items };
    _newsCache.set(topic, { data, exp: Date.now() + 30 * 60 * 1000 }); // 30 min
    res.json(data);
  } catch (e) {
    console.error('[macro/news]', topic, e.message);
    res.json({ topic, items: [], error: e.message });
  }
});

module.exports = router;

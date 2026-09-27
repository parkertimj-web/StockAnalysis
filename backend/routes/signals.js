'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { getHistory, getLiveQuote, primeQuotes, isQuoteFresh } = require('../services/yahooFinance');
const { analyseCandles } = require('../services/signalEngine');
const { summariseSignal } = require('../services/claudeAI');

const WARMUP_DAYS = 280;
const PERIOD_DAYS = 365; // always use 1yr + warmup for signal accuracy

async function fetchCandles(symbol) {
  const now = Math.floor(Date.now() / 1000);
  const from = now - (PERIOD_DAYS + WARMUP_DAYS) * 86400;
  const { candles } = await getHistory(symbol, from, now, '1d');
  return candles;
}

// Overlay the live intraday quote onto a signal — but only when it's fresh
// (last print no older than the latest daily bar). A stale/frozen feed is
// ignored so the analyseCandles price (fresh daily close) stands instead.
async function applyLiveQuote(signal, candles) {
  const prevClose = candles.length >= 2 ? candles[candles.length - 2].close : null;
  try {
    const lastBarTime = candles[candles.length - 1]?.time ?? 0;
    const lq = await getLiveQuote(signal.symbol);
    if (lq?.price && isQuoteFresh(lq, lastBarTime)) {
      signal.price       = lq.price;
      signal.dayHigh     = lq.high;
      signal.dayLow      = lq.low;
      signal.dayOpen     = lq.open;
      signal.volume      = lq.volume;
      signal.quoteTime   = lq.time;
      signal.quoteSource = lq.source;
      const base         = lq.prevClose ?? prevClose ?? lq.open;
      signal.change      = lq.price - base;
      signal.changePct   = base ? ((lq.price - base) / base) * 100 : 0;
      return;
    }
  } catch { /* fall through to the EOD close */ }
  signal.change      = prevClose != null ? signal.price - prevClose : null;
  signal.changePct   = prevClose ? ((signal.price - prevClose) / prevClose) * 100 : null;
  signal.quoteSource = 'eod';
}

// GET /api/signals/watchlist
router.get('/watchlist', async (req, res) => {
  try {
    const watchlistRows = db.prepare('SELECT symbol FROM watchlist WHERE user_id = 1').all();
    const symbols = watchlistRows.map(r => r.symbol);

    if (!symbols.length) return res.json([]);

    // Warm all live quotes in one batched Yahoo call so the per-symbol
    // getLiveQuote() calls below are instant cache hits (avoids slow sequential
    // per-symbol quote fetches).
    await primeQuotes([...symbols, 'SPY']).catch(() => {});

    // Fetch SPY first (single request)
    let spyCandles = null;
    let spyResult  = null;
    try {
      spyCandles = await fetchCandles('SPY');
      spyResult  = analyseCandles('SPY', spyCandles, null);
    } catch (e) {
      console.error('[signals] SPY fetch:', e.message);
    }

    // Analyse all symbols concurrently. Rate limiting lives in the data layer:
    // uncached history requests queue through the TwelveData throttle, while
    // cache hits and CBOE quote lookups proceed in parallel.
    const analysed = await Promise.all(symbols.map(async (sym) => {
      try {
        const candles = await fetchCandles(sym);
        const signal  = analyseCandles(sym, candles, spyCandles);
        if (!signal) return null;
        await applyLiveQuote(signal, candles);
        return signal;
      } catch (e) {
        console.error(`[signals] ${sym}:`, e.message);
        return null;
      }
    }));
    const results = analysed.filter(Boolean);

    // Add SPY result if not already in watchlist
    if (!symbols.includes('SPY') && spyResult) {
      const spy = { ...spyResult, isSpy: true };
      await applyLiveQuote(spy, spyCandles);
      results.push(spy);
    }

    res.json(results);
  } catch (e) {
    console.error('[signals]', e.message);
    res.status(500).json({ error: e.message });
  }
});

async function fetchSignal(symbol) {
  let spyCandles = null;
  try { spyCandles = await fetchCandles('SPY'); } catch {}
  const candles = await fetchCandles(symbol);
  return analyseCandles(symbol, candles, spyCandles);
}

// GET /api/signals/:symbol
router.get('/:symbol', async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  try {
    const signal = await fetchSignal(symbol);
    if (!signal) return res.status(404).json({ error: 'Insufficient data' });
    res.json(signal);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/signals/:symbol/summary (AI)
router.get('/:symbol/summary', async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  try {
    const signal = await fetchSignal(symbol);
    if (!signal) return res.status(404).json({ error: 'Insufficient data' });
    const summary = await summariseSignal(signal);
    res.json({ symbol, summary });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;

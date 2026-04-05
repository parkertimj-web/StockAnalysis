'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { getHistory, getStooqQuote } = require('../services/yahooFinance');
const { analyseCandles } = require('../services/signalEngine');
const { summariseSignal } = require('../services/claudeAI');

const WARMUP_DAYS = 280;
const PERIOD_DAYS = 365; // always use 1yr + warmup for signal accuracy
const FETCH_DELAY  = 350; // ms between sequential Yahoo requests

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fetchCandles(symbol) {
  const now = Math.floor(Date.now() / 1000);
  const from = now - (PERIOD_DAYS + WARMUP_DAYS) * 86400;
  const { candles } = await getHistory(symbol, from, now, '1d');
  return candles;
}

// GET /api/signals/watchlist
router.get('/watchlist', async (req, res) => {
  try {
    const watchlistRows = db.prepare('SELECT symbol FROM watchlist WHERE user_id = 1').all();
    const symbols = watchlistRows.map(r => r.symbol);

    if (!symbols.length) return res.json([]);

    // Fetch SPY first (single request)
    let spyCandles = null;
    let spyResult  = null;
    try {
      spyCandles = await fetchCandles('SPY');
      spyResult  = analyseCandles('SPY', spyCandles, null);
    } catch (e) {
      console.error('[signals] SPY fetch:', e.message);
    }

    // Fetch each watchlist symbol sequentially to avoid rate limits
    const results = [];
    for (const sym of symbols) {
      await sleep(FETCH_DELAY);
      try {
        const candles = await fetchCandles(sym);
        const signal  = analyseCandles(sym, candles, spyCandles);
        if (!signal) continue;

        // prevClose = last fully settled EOD bar close
        const prevClose = candles.length >= 2
          ? candles[candles.length - 2].close
          : null;

        // Overlay live delayed quote price (updates intraday, unlike EOD daily bars)
        try {
          const lq = await getStooqQuote(sym);
          if (lq?.price) {
            signal.price     = lq.price;
            signal.dayHigh   = lq.high;
            signal.dayLow    = lq.low;
            signal.dayOpen   = lq.open;
            signal.volume    = lq.volume;
            signal.quoteTime = lq.time;
            const base       = prevClose ?? lq.open;
            signal.change    = lq.price - base;
            signal.changePct = base ? ((lq.price - base) / base) * 100 : 0;
          }
        } catch { /* keep analyseCandles price on quote failure */ }

        results.push(signal);
      } catch (e) {
        console.error(`[signals] ${sym}:`, e.message);
      }
    }

    // Add SPY result if not already in watchlist
    if (!symbols.includes('SPY') && spyResult) {
      results.push({ ...spyResult, isSpy: true });
    }

    res.json(results);
  } catch (e) {
    console.error('[signals]', e.message);
    res.status(500).json({ error: e.message });
  }
});

async function fetchSignal(symbol) {
  // Fetch SPY and target symbol sequentially (cache means SPY is usually instant)
  let spyCandles = null;
  try { spyCandles = await fetchCandles('SPY'); } catch {}
  if (symbol !== 'SPY') await sleep(FETCH_DELAY);
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

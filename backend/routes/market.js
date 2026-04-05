'use strict';

const express = require('express');
const router = express.Router();
const { getHistory, getQuotes, getStooqQuote } = require('../services/yahooFinance');
const { getFundamentalsBatch, getMovingAvgBatch } = require('../services/secEdgar');
const {
  calculateSMAArray,
  calculateEMAArray,
  calculateVWAPArray,
  calculateBollingerBandsArray,
} = require('../services/indicators');

const PERIOD_DAYS = { '1mo': 30, '3mo': 90, '6mo': 180, '1y': 365, '2y': 730 };
const WARMUP_DAYS = 280;

// GET /api/market/indicators?symbol=AAPL&period=3mo&interval=1d
router.get('/indicators', async (req, res) => {
  const { symbol, period = '3mo', interval = '1d' } = req.query;
  if (!symbol) return res.status(400).json({ error: 'symbol required' });

  try {
    const periodDays = PERIOD_DAYS[period] || 90;
    const now = Math.floor(Date.now() / 1000);
    const periodStart = now - periodDays * 86400;
    const fetchStart = periodStart - WARMUP_DAYS * 86400;

    // Fetch history + live quote in parallel (live quote has 90s cache during market hours)
    const [{ candles, meta }, liveQuote] = await Promise.all([
      getHistory(symbol.toUpperCase(), fetchStart, now, interval),
      getStooqQuote(symbol.toUpperCase()).catch(() => null),
    ]);
    if (!candles.length) return res.status(404).json({ error: 'No data' });

    const closes = candles.map(c => c.close);

    // Compute all indicator arrays over full dataset
    const sma20Arr  = calculateSMAArray(closes, 20);
    const sma50Arr  = calculateSMAArray(closes, 50);
    const sma200Arr = calculateSMAArray(closes, 200);
    const ema9Arr   = calculateEMAArray(closes, 9);
    const ema21Arr  = calculateEMAArray(closes, 21);
    const vwapArr   = calculateVWAPArray(candles);
    const bbArr     = calculateBollingerBandsArray(closes, 20, 2);

    // Trim to requested period
    const trimmed = candles.reduce((acc, c, i) => {
      if (c.time >= periodStart) {
        acc.idx.push(i);
      }
      return acc;
    }, { idx: [] }).idx;

    const slice = (arr) => trimmed.map(i => arr[i] ?? null);

    const trimCandles = trimmed.map(i => candles[i]);
    const trimSma20  = slice(sma20Arr);
    const trimSma50  = slice(sma50Arr);
    const trimSma200 = slice(sma200Arr);
    const trimEma9   = slice(ema9Arr);
    const trimEma21  = slice(ema21Arr);
    const trimVwap   = slice(vwapArr);
    const trimBB     = slice(bbArr);

    // Build quote: live price from Stooq real-time endpoint, prev close from last historical bar
    const lastCandle = trimCandles[trimCandles.length - 1];
    const prevCandle = trimCandles[trimCandles.length - 2];

    // liveQuote.price = current session price (updates ~15 min delayed during market hours)
    // meta.regularMarketPrice = last historical daily close = previous close
    const regularMarketPrice = liveQuote?.price ?? meta.regularMarketPrice;
    const previousClose      = meta.regularMarketPrice; // last Stooq daily bar = yesterday's close

    const quote = {
      regularMarketPrice,
      previousClose,
      open:             liveQuote?.open    ?? meta.regularMarketOpen    ?? lastCandle?.open,
      dayHigh:          liveQuote?.high    ?? meta.regularMarketDayHigh ?? lastCandle?.high,
      dayLow:           liveQuote?.low     ?? meta.regularMarketDayLow  ?? lastCandle?.low,
      volume:           liveQuote?.volume  ?? meta.regularMarketVolume  ?? lastCandle?.volume,
      avgVolume:        meta.averageDailyVolume10Day ?? null,
      fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh,
      fiftyTwoWeekLow:  meta.fiftyTwoWeekLow,
      liveAt:           liveQuote?.date && liveQuote?.time
                          ? `${liveQuote.date} ${liveQuote.time}`
                          : null,
    };

    res.json({
      candles:  trimCandles,
      sma20:    trimSma20,
      sma50:    trimSma50,
      sma200:   trimSma200,
      ema9:     trimEma9,
      ema21:    trimEma21,
      vwap:     trimVwap,
      bb:       trimBB,
      quote,
    });
  } catch (e) {
    console.error('[market]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/market/quote?symbols=AAPL,MSFT
router.get('/quote', async (req, res) => {
  const { symbols } = req.query;
  if (!symbols) return res.status(400).json({ error: 'symbols required' });
  try {
    const quotes = await getQuotes(symbols.split(',').map(s => s.trim().toUpperCase()));
    res.json(quotes);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/market/fundamentals?symbols=AAPL,MSFT
// Fetches fundamentals from SEC EDGAR (official 10-Q/10-K XBRL data, cached 7 days in SQLite).
// Live prices are fetched in parallel with a 5-second timeout so cached fundamentals
// return quickly. If price fetch times out, pre-computed ratios from the cache are used.
router.get('/fundamentals', async (req, res) => {
  const { symbols } = req.query;
  if (!symbols) return res.status(400).json({ error: 'symbols required' });
  try {
    const symArr = symbols.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);

    // ── Live price fetch (max 5s) ─────────────────────────────────────────────
    // Prices update the P/E, PEG, P/B, market cap fields in the stored fundamentals.
    // If unavailable (timeout or error) the cached ratio values are returned as-is.
    const priceMap = {};
    const PRICE_TIMEOUT = 5000; // ms

    const pricePromise = (async () => {
      try {
        // Stooq is faster; fetch all symbols in parallel with 5s race
        await Promise.all(symArr.map(async s => {
          try {
            const q = await getStooqQuote(s);
            if (q?.price != null) priceMap[s] = q.price;
          } catch { /* ignore individual failures */ }
        }));
      } catch { /* ignore */ }
    })();

    await Promise.race([
      pricePromise,
      new Promise(resolve => setTimeout(resolve, PRICE_TIMEOUT)),
    ]);

    const results = await getFundamentalsBatch(symArr, priceMap);
    res.json(results);
  } catch (e) {
    console.error('[fundamentals route]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/market/moving-average?symbols=AAPL,TSLA
// Returns 12-month rolling TTM series for EPS, Revenue, Net Income, Margin, YoY Growth.
router.get('/moving-average', async (req, res) => {
  const { symbols } = req.query;
  if (!symbols) return res.status(400).json({ error: 'symbols required' });
  try {
    const symArr = symbols.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    const results = await getMovingAvgBatch(symArr);
    res.json(results);
  } catch (e) {
    console.error('[moving-average route]', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;

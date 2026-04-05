'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { getHistory } = require('../services/yahooFinance');
const { runBacktest } = require('../services/backtestEngine');

// POST /api/backtest/run
router.post('/run', async (req, res) => {
  const {
    symbol,
    period = '2y',
    rsiOversold = 40,
    rsiOverbought = 65,
    rsiPeriod = 14,
    smaPeriod = 50,
    requireAboveSMA = true,
    atrMultiplierStop = 2,
    atrMultiplierTarget = 4,
  } = req.body;

  if (!symbol) return res.status(400).json({ error: 'symbol required' });

  const periodDays = { '6mo': 180, '1y': 365, '2y': 730, '3y': 1095, '5y': 1825 };
  const days = periodDays[period] || 730;

  try {
    const now = Math.floor(Date.now() / 1000);
    const from = now - (days + 280) * 86400;
    const { candles } = await getHistory(symbol.toUpperCase(), from, now, '1d');

    if (candles.length < 60) return res.status(400).json({ error: 'Insufficient data' });

    const config = {
      rsiOversold: parseFloat(rsiOversold),
      rsiOverbought: parseFloat(rsiOverbought),
      rsiPeriod: parseInt(rsiPeriod),
      smaPeriod: parseInt(smaPeriod),
      requireAboveSMA: Boolean(requireAboveSMA),
      atrMultiplierStop: parseFloat(atrMultiplierStop),
      atrMultiplierTarget: parseFloat(atrMultiplierTarget),
    };

    const { trades, stats } = runBacktest(candles, config);

    // Save result
    db.prepare(
      'INSERT INTO backtest_results (symbol, config, results) VALUES (?, ?, ?)'
    ).run(symbol.toUpperCase(), JSON.stringify(config), JSON.stringify({ trades, stats }));

    res.json({ symbol: symbol.toUpperCase(), config, trades, stats });
  } catch (e) {
    console.error('[backtest]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/backtest/history
router.get('/history', (req, res) => {
  try {
    const rows = db.prepare(
      'SELECT id, symbol, config, run_at, json_extract(results, "$.stats") as stats FROM backtest_results ORDER BY run_at DESC LIMIT 50'
    ).all();
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/backtest/:id
router.get('/:id', (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM backtest_results WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json({ ...row, config: JSON.parse(row.config), results: JSON.parse(row.results) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;

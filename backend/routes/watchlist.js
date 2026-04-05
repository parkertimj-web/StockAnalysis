'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db/database');

// GET /api/watchlist
router.get('/', (req, res) => {
  try {
    const rows = db.prepare(
      'SELECT symbol, added_at FROM watchlist WHERE user_id = 1 ORDER BY added_at ASC'
    ).all();
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/watchlist
router.post('/', (req, res) => {
  const { symbol } = req.body;
  if (!symbol) return res.status(400).json({ error: 'symbol required' });
  try {
    db.prepare(
      'INSERT OR IGNORE INTO watchlist (user_id, symbol) VALUES (1, ?)'
    ).run(symbol.toUpperCase().trim());
    res.json({ ok: true, symbol: symbol.toUpperCase().trim() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/watchlist/:symbol
router.delete('/:symbol', (req, res) => {
  try {
    db.prepare(
      'DELETE FROM watchlist WHERE user_id = 1 AND symbol = ?'
    ).run(req.params.symbol.toUpperCase());
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;

'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { analyseJournalTrade } = require('../services/claudeAI');

// GET /api/journal
router.get('/', (req, res) => {
  try {
    const { status } = req.query;
    let query = 'SELECT * FROM trade_journal WHERE user_id = 1';
    const params = [];
    if (status) { query += ' AND status = ?'; params.push(status); }
    query += ' ORDER BY entry_date DESC';
    const trades = db.prepare(query).all(...params);
    res.json(trades);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/journal/stats
router.get('/stats', (req, res) => {
  try {
    const all = db.prepare('SELECT * FROM trade_journal WHERE user_id = 1').all();
    const closed = all.filter(t => t.status === 'closed' && t.pnl !== null);
    const open = all.filter(t => t.status === 'open');

    const totalPnl = closed.reduce((a, t) => a + t.pnl, 0);
    const winners = closed.filter(t => t.pnl > 0);
    const losers = closed.filter(t => t.pnl <= 0);
    const winRate = closed.length > 0 ? (winners.length / closed.length) * 100 : 0;
    const avgWin = winners.length > 0 ? winners.reduce((a, t) => a + t.pnl, 0) / winners.length : 0;
    const avgLoss = losers.length > 0 ? losers.reduce((a, t) => a + t.pnl, 0) / losers.length : 0;

    res.json({
      totalTrades: all.length,
      openTrades: open.length,
      closedTrades: closed.length,
      totalPnl,
      winRate,
      winners: winners.length,
      losers: losers.length,
      avgWin,
      avgLoss,
      expectancy: closed.length > 0
        ? (winners.length / closed.length) * avgWin + (losers.length / closed.length) * avgLoss
        : 0,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/journal
router.post('/', (req, res) => {
  const {
    symbol, trade_type, direction, entry_date, entry_price,
    quantity, stop_loss, target_price, notes, tags,
  } = req.body;

  if (!symbol || !entry_date || entry_price === undefined || quantity === undefined) {
    return res.status(400).json({ error: 'symbol, entry_date, entry_price, quantity required' });
  }

  try {
    const result = db.prepare(`
      INSERT INTO trade_journal
        (user_id, symbol, trade_type, direction, entry_date, entry_price, quantity, stop_loss, target_price, notes, tags, status)
      VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open')
    `).run(
      symbol.toUpperCase(), trade_type || 'stock', direction || 'long',
      entry_date, parseFloat(entry_price), parseFloat(quantity),
      stop_loss ? parseFloat(stop_loss) : null,
      target_price ? parseFloat(target_price) : null,
      notes || null, tags || null
    );
    const trade = db.prepare('SELECT * FROM trade_journal WHERE id = ?').get(result.lastInsertRowid);
    res.json(trade);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/journal/:id/close
router.patch('/:id/close', (req, res) => {
  const { exit_price, exit_date } = req.body;
  if (exit_price === undefined) return res.status(400).json({ error: 'exit_price required' });

  try {
    const trade = db.prepare('SELECT * FROM trade_journal WHERE id = ? AND user_id = 1').get(req.params.id);
    if (!trade) return res.status(404).json({ error: 'Trade not found' });

    const multiplier = trade.direction === 'short' ? -1 : 1;
    const pnl = (parseFloat(exit_price) - trade.entry_price) * trade.quantity * multiplier;

    db.prepare(`
      UPDATE trade_journal SET exit_price = ?, exit_date = ?, pnl = ?, status = 'closed' WHERE id = ?
    `).run(parseFloat(exit_price), exit_date || new Date().toISOString().slice(0, 10), pnl, req.params.id);

    const updated = db.prepare('SELECT * FROM trade_journal WHERE id = ?').get(req.params.id);
    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/journal/:id
router.delete('/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM trade_journal WHERE id = ? AND user_id = 1').run(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/journal/:id/ai-analysis
router.get('/:id/ai-analysis', async (req, res) => {
  try {
    const trade = db.prepare('SELECT * FROM trade_journal WHERE id = ? AND user_id = 1').get(req.params.id);
    if (!trade) return res.status(404).json({ error: 'Trade not found' });
    const analysis = await analyseJournalTrade(trade);
    res.json({ analysis });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;

'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { addSSEClient } = require('../services/alertService');

// SSE stream
router.get('/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();
  res.write('data: {"type":"connected"}\n\n');

  addSSEClient(res);

  // Heartbeat
  const hb = setInterval(() => {
    try { res.write(': heartbeat\n\n'); } catch { clearInterval(hb); }
  }, 30000);

  req.on('close', () => clearInterval(hb));
});

// GET /api/alerts
router.get('/', (req, res) => {
  try {
    const alerts = db.prepare(
      'SELECT * FROM alerts WHERE user_id = 1 ORDER BY created_at DESC'
    ).all();
    res.json(alerts);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/alerts/log
router.get('/log', (req, res) => {
  try {
    const logs = db.prepare(
      'SELECT * FROM alert_log ORDER BY fired_at DESC LIMIT 100'
    ).all();
    res.json(logs);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/alerts
router.post('/', (req, res) => {
  const { symbol, alert_type, condition, value, message } = req.body;
  if (!symbol || !condition || value === undefined) {
    return res.status(400).json({ error: 'symbol, condition, value required' });
  }
  try {
    const result = db.prepare(
      `INSERT INTO alerts (user_id, symbol, alert_type, condition, value, message)
       VALUES (1, ?, ?, ?, ?, ?)`
    ).run(
      symbol.toUpperCase(),
      alert_type || 'price',
      condition,
      parseFloat(value),
      message || null
    );
    res.json({ ok: true, id: result.lastInsertRowid });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/alerts/:id
router.delete('/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM alerts WHERE id = ? AND user_id = 1').run(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/alerts/:id/toggle
router.patch('/:id/toggle', (req, res) => {
  try {
    db.prepare(
      'UPDATE alerts SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END WHERE id = ?'
    ).run(req.params.id);
    const alert = db.prepare('SELECT * FROM alerts WHERE id = ?').get(req.params.id);
    res.json(alert);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/alerts/subscribe (web push)
router.post('/subscribe', (req, res) => {
  const { endpoint, keys } = req.body;
  if (!endpoint || !keys) return res.status(400).json({ error: 'Invalid subscription' });
  try {
    db.prepare(
      'INSERT OR REPLACE INTO push_subscriptions (endpoint, p256dh, auth) VALUES (?, ?, ?)'
    ).run(endpoint, keys.p256dh, keys.auth);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const IS_PROD = process.env.NODE_ENV === 'production';

// ── Keep the process alive — log crashes instead of exiting ──────────────────
process.on('uncaughtException',      err => console.error('[uncaughtException]',      err.message, err.stack));
process.on('unhandledRejection', (reason) => console.error('[unhandledRejection]', reason));

// ── Auto-kill any process already on our port before binding ─────────────────
// In production Railway sets PORT; locally use API_PORT or 3001
const { execSync } = require('child_process');
const PORT = parseInt(process.env.PORT || process.env.API_PORT || '3001', 10);
try {
  const pids = execSync(`lsof -ti:${PORT}`, { encoding: 'utf8' }).trim();
  if (pids) {
    pids.split('\n').forEach(pid => { try { process.kill(Number(pid), 'SIGKILL'); } catch {} });
    console.log(`[startup] Cleared stale process(es) on port ${PORT}`);
    // Brief pause so OS releases the port before we bind
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
  }
} catch { /* no process on that port — normal */ }

const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const path = require('path');

const app = express();

// Middleware
// In production the frontend is served from the same origin — no CORS needed
app.use(cors({ origin: IS_PROD ? false : (process.env.FRONTEND_URL || 'http://localhost:5173') }));
app.use(express.json());

// Routes
app.use('/api/watchlist', require('./routes/watchlist'));
app.use('/api/market',    require('./routes/market'));
app.use('/api/options',   require('./routes/options'));
app.use('/api/alerts',    require('./routes/alerts'));
app.use('/api/journal',   require('./routes/journal'));
app.use('/api/backtest',  require('./routes/backtest'));
app.use('/api/signals',   require('./routes/signals'));

// VAPID public key endpoint
app.get('/api/vapid-public-key', (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || null });
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// ── Serve React frontend in production ───────────────────────────────────────
if (IS_PROD) {
  const frontendDist = path.join(__dirname, '../frontend/dist');
  app.use(express.static(frontendDist));
  // All non-API routes go to React
  app.get('*', (req, res) => {
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
}

// ── Cron job: evaluate signals every 15 min on market days 9-16 ET ──
// ET is UTC-5 (EST) / UTC-4 (EDT) — use UTC 14:00-21:00 range as rough cover
cron.schedule('*/15 14-21 * * 1-5', async () => { // market hours Mon-Fri ET only
  try {
    const db = require('./db/database');
    const { getHistory } = require('./services/yahooFinance');
    const { analyseCandles } = require('./services/signalEngine');
    const { checkAlerts } = require('./services/alertService');

    const symbols = db.prepare('SELECT DISTINCT symbol FROM watchlist').all().map(r => r.symbol);
    if (!symbols.length) return;

    const now = Math.floor(Date.now() / 1000);
    const from = now - (365 + 280) * 86400;

    let spyCandles = null;
    try {
      const { candles } = await getHistory('SPY', from, now, '1d');
      spyCandles = candles;
    } catch {}

    for (const sym of symbols) {
      await new Promise(r => setTimeout(r, 350));
      try {
        const { candles } = await getHistory(sym, from, now, '1d');
        const signal = analyseCandles(sym, candles, spyCandles);
        if (signal) {
          await checkAlerts(sym, signal.price);
          db.prepare(
            `INSERT INTO signal_history (symbol, price, signal, score, max_score, components)
             VALUES (?, ?, ?, ?, ?, ?)`
          ).run(
            sym, signal.price,
            signal.scores.regime.signal,
            signal.scores.regime.score,
            signal.scores.regime.max,
            JSON.stringify(signal.components)
          );
        }
      } catch (e) {
        console.error(`[cron] ${sym}:`, e.message);
      }
    }
    console.log(`[cron] Signal scan complete for ${symbols.length} symbols`);
  } catch (e) {
    console.error('[cron] Error:', e.message);
  }
});

const server = app.listen(PORT, () => {
  console.log(`Stock Signal API running on http://localhost:${PORT}`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.warn(`[startup] Port ${PORT} still busy — retrying kill…`);
    try { execSync(`lsof -ti:${PORT} | xargs kill -9`, { stdio: 'ignore' }); } catch {}
    setTimeout(() => server.listen(PORT), 500);
  } else {
    throw err;
  }
});

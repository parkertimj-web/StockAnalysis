'use strict';

const db = require('../db/database');
const nodemailer = require('nodemailer');
const webPush = require('web-push');

// SSE clients registry
const sseClients = new Set();

function addSSEClient(res) {
  sseClients.add(res);
  res.on('close', () => sseClients.delete(res));
}

function broadcastAlert(payload) {
  const data = JSON.stringify(payload);
  for (const client of sseClients) {
    try {
      client.write(`data: ${data}\n\n`);
    } catch (e) {
      sseClients.delete(client);
    }
  }
}

// Configure VAPID if keys are set
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webPush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:admin@stockapp.local',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

async function sendEmail(subject, text) {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER) return;
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: false,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: process.env.SMTP_USER,
    subject,
    text,
  });
}

async function sendPushNotification(title, body) {
  if (!process.env.VAPID_PUBLIC_KEY) return;
  const subs = db.prepare('SELECT * FROM push_subscriptions').all();
  for (const sub of subs) {
    try {
      await webPush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify({ title, body })
      );
    } catch (e) {
      if (e.statusCode === 410) {
        db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(sub.id);
      }
    }
  }
}

async function fireAlert(alert, price) {
  const message = `${alert.symbol} ${alert.condition} ${alert.value} — current price: $${price?.toFixed(2)}`;

  // Log to DB
  db.prepare(
    'INSERT INTO alert_log (alert_id, symbol, message, price) VALUES (?, ?, ?, ?)'
  ).run(alert.id, alert.symbol, message, price);

  // If one-time, deactivate
  if (alert.alert_type === 'price_once') {
    db.prepare('UPDATE alerts SET is_active = 0 WHERE id = ?').run(alert.id);
  }

  // Broadcast SSE
  broadcastAlert({ type: 'alert', symbol: alert.symbol, message, price, alertId: alert.id });

  // Email (non-blocking)
  sendEmail(`Stock Alert: ${alert.symbol}`, message).catch(() => {});

  // Push (non-blocking)
  sendPushNotification(`Stock Alert: ${alert.symbol}`, message).catch(() => {});
}

async function checkAlerts(symbol, price) {
  const alerts = db.prepare(
    'SELECT * FROM alerts WHERE symbol = ? AND is_active = 1'
  ).all(symbol);

  for (const alert of alerts) {
    let triggered = false;
    if (alert.condition === 'above' && price > alert.value) triggered = true;
    if (alert.condition === 'below' && price < alert.value) triggered = true;

    if (triggered) await fireAlert(alert, price);
  }
}

module.exports = { addSSEClient, broadcastAlert, checkAlerts, fireAlert };

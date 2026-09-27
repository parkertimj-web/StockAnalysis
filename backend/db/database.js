const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const schema = require('./schema');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, 'stocks.db');
const db = new DatabaseSync(dbPath);

// Wait up to 5s for competing locks instead of throwing "database is locked"
// (e.g. a CLI script or second process touching the DB during startup)
db.exec('PRAGMA busy_timeout = 5000');
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

// Run schema (node:sqlite exec handles multiple semicolon-delimited statements)
try {
  db.exec(schema);
} catch (e) {
  if (!e.message.includes('already exists') && !e.message.includes('UNIQUE constraint')) {
    console.warn('Schema warning:', e.message);
  }
}

// Additive column migrations for databases created before the column existed.
// `armed` = 1 while a recurring alert may fire; set to 0 after it fires and back
// to 1 once its condition clears, so it fires once per crossing, not every scan.
for (const sql of [
  'ALTER TABLE alerts ADD COLUMN armed INTEGER NOT NULL DEFAULT 1',
]) {
  try { db.exec(sql); } catch (e) {
    if (!e.message.includes('duplicate column')) console.warn('Migration warning:', e.message);
  }
}

module.exports = db;

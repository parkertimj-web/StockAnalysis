const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const schema = require('./schema');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, 'stocks.db');
const db = new DatabaseSync(dbPath);

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

module.exports = db;

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const dbPath = process.env.DB_PATH || path.join(__dirname, 'data', 'cards.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS cards (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  name             TEXT NOT NULL,
  set_name         TEXT DEFAULT '',
  card_number      TEXT DEFAULT '',
  variant          TEXT DEFAULT 'normal',
  condition        TEXT DEFAULT 'NM',
  quantity         INTEGER NOT NULL DEFAULT 0,
  cost_basis       REAL NOT NULL DEFAULT 0,
  market_price     REAL,
  price_updated_at TEXT,
  image_url        TEXT DEFAULT '',
  tcg_card_id      TEXT DEFAULT '',
  notes            TEXT DEFAULT '',
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS shows (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  date       TEXT DEFAULT '',
  venue      TEXT DEFAULT '',
  table_fee  REAL NOT NULL DEFAULT 0,
  notes      TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS transactions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  type        TEXT NOT NULL CHECK (type IN ('purchase','sale','expense','adjustment')),
  card_id     INTEGER REFERENCES cards(id) ON DELETE SET NULL,
  show_id     INTEGER REFERENCES shows(id) ON DELETE SET NULL,
  quantity    INTEGER NOT NULL DEFAULT 1,
  unit_price  REAL NOT NULL DEFAULT 0,
  total       REAL NOT NULL DEFAULT 0,
  description TEXT DEFAULT '',
  date        TEXT NOT NULL DEFAULT (datetime('now')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS watches (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  retailer     TEXT NOT NULL CHECK (retailer IN ('target','bestbuy','barnesnoble')),
  sku          TEXT NOT NULL,
  product_name TEXT DEFAULT '',
  zip_code     TEXT DEFAULT '',
  store_id     TEXT DEFAULT '',
  active       INTEGER NOT NULL DEFAULT 1,
  last_status  TEXT NOT NULL DEFAULT 'unknown',
  last_checked TEXT,
  last_error   TEXT DEFAULT '',
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS alerts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  watch_id   INTEGER REFERENCES watches(id) ON DELETE CASCADE,
  message    TEXT NOT NULL,
  seen       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS price_cache (
  query      TEXT PRIMARY KEY,
  payload    TEXT NOT NULL,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_transactions_card ON transactions(card_id);
CREATE INDEX IF NOT EXISTS idx_transactions_show ON transactions(show_id);
CREATE INDEX IF NOT EXISTS idx_alerts_seen ON alerts(seen);
`);

const DEFAULT_SETTINGS = {
  sell_percentage: '80',
  discord_webhook_url: '',
  pokemontcg_api_key: '',
  bestbuy_api_key: '',
  watch_poll_minutes: '5',
  anthropic_api_key: '',
  scan_model: 'claude-opus-4-8',
  gemini_api_key: '',
};

const insertDefault = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
  insertDefault.run(key, value);
}

export function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : undefined;
}

export function getAllSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export function setSettings(obj) {
  const upsert = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  );
  const tx = db.transaction((entries) => {
    for (const [key, value] of entries) upsert.run(key, String(value));
  });
  tx(Object.entries(obj));
  return getAllSettings();
}

export default db;

// db.js - Local SQLite database via sql.js (pure JavaScript, no compilation needed)
// Stands in for Azure PostgreSQL Flexible Server from the Assignment 1 plan.
const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

const DB_PATH = path.join(__dirname, 'mytax.db');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  role TEXT NOT NULL DEFAULT 'user',            -- 'superadmin' | 'useradmin' | 'user'
  subscription TEXT NOT NULL DEFAULT 'freemium',-- 'freemium' | 'premium'
  status TEXT NOT NULL DEFAULT 'active',        -- 'active' | 'disabled'
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS invites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  invited_by TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  merchant TEXT NOT NULL,
  receipt_date TEXT NOT NULL,
  amount REAL NOT NULL,
  category TEXT NOT NULL,
  notes TEXT DEFAULT '',
  filename TEXT NOT NULL,
  original_name TEXT NOT NULL,
  tier TEXT NOT NULL DEFAULT 'hot',
  ocr_used INTEGER NOT NULL DEFAULT 0,
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS otps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  code_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);`;

async function initDb() {
  const SQL = await initSqlJs();
  const db = fs.existsSync(DB_PATH)
    ? new SQL.Database(fs.readFileSync(DB_PATH))
    : new SQL.Database();
  db.run(SCHEMA);

  // Migration for databases created before v2.2: add the flag column if missing.
  try { db.run('ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0'); } catch (e) { /* column already exists */ }
  // Migrations for databases created before v3.0: role/subscription/status columns.
  try { db.run("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'"); } catch (e) { /* exists */ }
  try { db.run("ALTER TABLE users ADD COLUMN subscription TEXT NOT NULL DEFAULT 'freemium'"); } catch (e) { /* exists */ }
  try { db.run("ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active'"); } catch (e) { /* exists */ }

  const persist = () => fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
  persist();

  function all(sql, params = []) {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  }
  function get(sql, params = []) {
    return all(sql, params)[0] || null;
  }
  function run(sql, params = []) {
    db.run(sql, params);
    const row = get('SELECT last_insert_rowid() AS id');
    persist();
    return { lastInsertRowid: row ? row.id : null };
  }
  return { all, get, run };
}

module.exports = initDb;

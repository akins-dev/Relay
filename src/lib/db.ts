import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'data/registry.db');

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  initSchema(_db);
  return _db;
}

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      github_username TEXT,
      avatar_url TEXT,
      bio TEXT,
      website TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS servers (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL,
      description TEXT NOT NULL,
      long_description TEXT,
      author_id TEXT NOT NULL REFERENCES users(id),
      version TEXT NOT NULL DEFAULT '1.0.0',
      endpoint TEXT NOT NULL,
      homepage_url TEXT,
      github_url TEXT,
      license TEXT DEFAULT 'MIT',
      tags TEXT NOT NULL DEFAULT '[]',
      tools TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'pending',
      verified INTEGER NOT NULL DEFAULT 0,
      stars INTEGER NOT NULL DEFAULT 0,
      total_calls INTEGER NOT NULL DEFAULT 0,
      calls_today INTEGER NOT NULL DEFAULT 0,
      latency_ms INTEGER,
      uptime_pct REAL DEFAULT 100.0,
      trust_score REAL DEFAULT 50.0,
      schema_hash TEXT,
      last_scanned_at INTEGER,
      scan_status TEXT DEFAULT 'pending',
      scan_issues TEXT DEFAULT '[]',
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS server_stars (
      user_id TEXT NOT NULL REFERENCES users(id),
      server_id TEXT NOT NULL REFERENCES servers(id),
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (user_id, server_id)
    );

    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      key_hash TEXT NOT NULL,
      key_prefix TEXT NOT NULL,
      name TEXT NOT NULL,
      last_used_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      server_id TEXT REFERENCES servers(id),
      user_id TEXT REFERENCES users(id),
      action TEXT NOT NULL,
      tool_name TEXT,
      request_size INTEGER,
      response_size INTEGER,
      latency_ms INTEGER,
      status_code INTEGER,
      ip TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS scan_results (
      id TEXT PRIMARY KEY,
      server_id TEXT NOT NULL REFERENCES servers(id),
      scan_type TEXT NOT NULL,
      passed INTEGER NOT NULL,
      issues TEXT NOT NULL DEFAULT '[]',
      score INTEGER DEFAULT 100,
      details TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_servers_status ON servers(status);
    CREATE INDEX IF NOT EXISTS idx_servers_trust ON servers(trust_score DESC);
    CREATE INDEX IF NOT EXISTS idx_servers_stars ON servers(stars DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_server ON audit_log(server_id);
    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);
  `);
}

export function formatServer(s: any) {
  return {
    ...s,
    tags: tryParse(s.tags, []),
    tools: tryParse(s.tools, []),
    scan_issues: tryParse(s.scan_issues, []),
    verified: s.verified === 1,
  };
}

function tryParse(val: string, fallback: any) {
  try { return JSON.parse(val); } catch { return fallback; }
}

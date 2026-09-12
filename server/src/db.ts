import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE'
);

CREATE TABLE IF NOT EXISTS providers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  provider_id INTEGER NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  vera_mode TEXT NOT NULL DEFAULT 'INTEGRITY_ONLY'
);

CREATE TABLE IF NOT EXISTS policies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id INTEGER NOT NULL UNIQUE,
  max_budget_cents INTEGER NOT NULL,
  spent_cents INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL UNIQUE,
  idempotency_key TEXT NOT NULL UNIQUE,
  agent_id INTEGER NOT NULL,
  provider_id INTEGER,
  service_id INTEGER,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 1,
  spent_before_cents INTEGER NOT NULL DEFAULT 0,
  remaining_before_cents INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_id INTEGER NOT NULL UNIQUE,
  request_id TEXT NOT NULL,
  result TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  verification_status TEXT NOT NULL DEFAULT 'UNVERIFIED',
  vera_verdict TEXT,
  vera_evidence TEXT,
  verified_at TEXT
);

CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  request_id TEXT,
  payment_id INTEGER,
  description TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}',
  timestamp TEXT NOT NULL
);
`;

export function openDb(path = ':memory:'): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return db;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function asNumber(v: unknown): number {
  return typeof v === 'bigint' ? Number(v) : (v as number);
}

export function dollars(cents: number): number {
  return cents / 100;
}

export function toCents(d: number): number {
  return Math.round(d * 100);
}
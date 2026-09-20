// An observatory.db without the session_kind column must gain it without losing
// a single row — recommendation statuses are the only data a re-scan cannot
// rebuild.

import { expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { openStore } from '../../src/server/observatory/store.ts';

// Copy of a sessions schema without session_kind — the point of the test is
// opening a database written before that column existed.
const M1_SESSIONS = `CREATE TABLE sessions (
  id TEXT PRIMARY KEY, project TEXT, transcript_path TEXT,
  file_mtime INTEGER, file_size INTEGER, scan_version INTEGER,
  started_at TEXT, ended_at TEXT, model_main TEXT,
  net_tokens INTEGER, cost_usd REAL, cost_complete INTEGER, report_json TEXT)`;

test('opening a database without session_kind adds the column, rows intact', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'obs-mig-'));
  const dbPath = path.join(dir, 'observatory.db');
  const db = new DatabaseSync(dbPath);
  db.exec(M1_SESSIONS);
  db.prepare(`INSERT INTO sessions (id, project, scan_version) VALUES ('old-1', 'F--p', 1)`).run();
  db.close();

  const store = openStore(dbPath);
  try {
    const row = store.getSession('old-1');
    expect(row!.id).toBe('old-1');
    expect(row!.sessionKind, 'pre-migration rows have no kind, never a guessed one').toBe(null);
  } finally {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Copie d'un schéma des recommandations sans les colonnes du statut arbitré — le
// test ouvre une base écrite avant ces colonnes, statuts posés compris.
const V017_RECOMMENDATIONS = `CREATE TABLE recommendations (
  id INTEGER PRIMARY KEY, rule_id TEXT, subject TEXT,
  created_at TEXT, updated_at TEXT, last_seen_at TEXT,
  title TEXT, category TEXT, confidence TEXT,
  estimated_cost_usd REAL, cost_basis TEXT,
  period_from TEXT, period_to TEXT,
  evidence_json TEXT, action TEXT,
  status TEXT DEFAULT 'new', cost_at_status_usd REAL)`;

test('une base sans les colonnes du statut arbitré gagne status_reason et status_at, statuts posés intacts', () => {
  // Arrange
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'obs-mig3-'));
  const dbPath = path.join(dir, 'observatory.db');
  const db = new DatabaseSync(dbPath);
  db.exec(V017_RECOMMENDATIONS);
  db.prepare(`INSERT INTO recommendations
    (rule_id, subject, created_at, updated_at, last_seen_at, title, category, confidence,
     estimated_cost_usd, cost_basis, evidence_json, action, status, cost_at_status_usd)
    VALUES ('R7', 'F--boulot', 't0', 't0', 't0', 't', 'c', 'fait', 2, 'jetons-mesures',
     '{}', 'a', 'ignored', 2)`).run();
  db.close();

  // Act
  const store = openStore(dbPath);

  // Assert
  try {
    const [row] = store.listRecommendations({});
    expect(row!.status, 'le statut posé avant migration survit').toBe('ignored');
    expect(row!.statusReason, 'pas de raison inventée aux lignes anciennes').toBe(null);
    expect(row!.statusAt, 'pas de date inventée non plus').toBe(null);
  } finally {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('applyMigrations is idempotent — a second open changes nothing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'obs-mig2-'));
  const dbPath = path.join(dir, 'observatory.db');
  openStore(dbPath).close();
  const store = openStore(dbPath); // must not throw "duplicate column"
  try {
    expect(store.listSessions({})).toEqual([]);
  } finally {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

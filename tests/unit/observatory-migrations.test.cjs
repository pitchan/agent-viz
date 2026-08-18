'use strict';
// An M1 (v0.3.x) observatory.db must gain the M1.1 columns without losing a
// single row — recommendation statuses are the only data a re-scan cannot
// rebuild.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const { openStore } = require('../../src/server/observatory/store.ts');

// Copy of the M1 schema as shipped in v0.3.1 (before this change) — the
// point of the test is opening a database built by the PREVIOUS version.
const M1_SESSIONS = `CREATE TABLE sessions (
  id TEXT PRIMARY KEY, project TEXT, transcript_path TEXT,
  file_mtime INTEGER, file_size INTEGER, scan_version INTEGER,
  started_at TEXT, ended_at TEXT, model_main TEXT,
  net_tokens INTEGER, cost_usd REAL, cost_complete INTEGER, report_json TEXT)`;

test('opening an M1 database adds session_kind and period columns, rows intact', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'obs-mig-'));
  const dbPath = path.join(dir, 'observatory.db');
  const db = new DatabaseSync(dbPath);
  db.exec(M1_SESSIONS);
  db.prepare(`INSERT INTO sessions (id, project, scan_version) VALUES ('old-1', 'F--p', 1)`).run();
  db.close();

  const store = openStore(dbPath);
  try {
    const row = store.getSession('old-1');
    assert.equal(row.id, 'old-1');
    assert.equal(row.sessionKind, null, 'pre-migration rows have no kind, never a guessed one');
  } finally {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Copie du schéma des recommandations tel que livré en 0.17.0 (avant le
// statut « arbitré ») — le test ouvre une base construite par la version
// PRÉCÉDENTE, statuts posés compris.
const V017_RECOMMENDATIONS = `CREATE TABLE recommendations (
  id INTEGER PRIMARY KEY, rule_id TEXT, subject TEXT,
  created_at TEXT, updated_at TEXT, last_seen_at TEXT,
  title TEXT, category TEXT, confidence TEXT,
  estimated_cost_usd REAL, cost_basis TEXT,
  period_from TEXT, period_to TEXT,
  evidence_json TEXT, action TEXT,
  status TEXT DEFAULT 'new', cost_at_status_usd REAL)`;

test('une base 0.17.0 gagne status_reason et status_at, statuts posés intacts', () => {
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
    assert.equal(row.status, 'ignored', 'le statut posé avant migration survit');
    assert.equal(row.statusReason, null, 'pas de raison inventée aux lignes anciennes');
    assert.equal(row.statusAt, null, 'pas de date inventée non plus');
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
    assert.deepEqual(store.listSessions({}), []);
  } finally {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

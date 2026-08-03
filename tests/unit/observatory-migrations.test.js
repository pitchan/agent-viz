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

const { openStore } = require('../../lib/server/observatory/store');

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

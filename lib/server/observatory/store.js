'use strict';
// SQLite persistence for the observatory — metadata only, never content.
//
// The database is a disposable derivative: transcripts remain the source of
// truth, so deleting the file is safe (it rebuilds on the next scan). This
// module stores and reads; it holds no domain knowledge about what a churn
// cause, a ranking or a stale recommendation means.

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { applyMigrations } = require('./migrations');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  project TEXT,
  transcript_path TEXT,
  file_mtime INTEGER, file_size INTEGER,
  scan_version INTEGER,
  started_at TEXT, ended_at TEXT,
  model_main TEXT,
  session_kind TEXT,
  net_tokens INTEGER,
  cost_usd REAL, cost_complete INTEGER,
  report_json TEXT
);
CREATE TABLE IF NOT EXISTS config_items (
  id INTEGER PRIMARY KEY, taken_at TEXT,
  kind TEXT, name TEXT, scope TEXT,
  detail_json TEXT
);
CREATE TABLE IF NOT EXISTS recommendations (
  id INTEGER PRIMARY KEY,
  rule_id TEXT, subject TEXT,
  created_at TEXT, updated_at TEXT, last_seen_at TEXT,
  title TEXT, category TEXT,
  confidence TEXT,
  estimated_cost_usd REAL,
  cost_basis TEXT,
  period_from TEXT, period_to TEXT,
  evidence_json TEXT,
  action TEXT,
  status TEXT DEFAULT 'new',
  cost_at_status_usd REAL
);
CREATE UNIQUE INDEX IF NOT EXISTS recommendations_identity
  ON recommendations (rule_id, subject);
CREATE TABLE IF NOT EXISTS scan_state (
  claude_dir TEXT PRIMARY KEY, last_scan_at TEXT, engine_version TEXT
);
`;

function toSessionRow(r) {
  return {
    id: r.id, project: r.project, transcriptPath: r.transcript_path,
    fileMtime: r.file_mtime, fileSize: r.file_size, scanVersion: r.scan_version,
    startedAt: r.started_at, endedAt: r.ended_at, modelMain: r.model_main,
    sessionKind: r.session_kind,
    netTokens: r.net_tokens, costUsd: r.cost_usd, costComplete: r.cost_complete === 1,
    reportJson: r.report_json,
  };
}

function toRecommendation(r) {
  return {
    id: r.id, ruleId: r.rule_id, subject: r.subject,
    title: r.title, category: r.category, confidence: r.confidence,
    estimatedCostUsd: r.estimated_cost_usd, costBasis: r.cost_basis,
    periodFrom: r.period_from, periodTo: r.period_to,
    evidence: JSON.parse(r.evidence_json), action: r.action,
    status: r.status, createdAt: r.created_at, updatedAt: r.updated_at,
    lastSeenAt: r.last_seen_at, costAtStatusUsd: r.cost_at_status_usd,
  };
}

function openStore(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(SCHEMA);
  applyMigrations(db);

  const insertSession = db.prepare(`
    INSERT INTO sessions (id, project, transcript_path, file_mtime, file_size, scan_version,
      started_at, ended_at, model_main, session_kind, net_tokens, cost_usd, cost_complete, report_json)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      project=excluded.project, transcript_path=excluded.transcript_path,
      file_mtime=excluded.file_mtime, file_size=excluded.file_size,
      scan_version=excluded.scan_version, started_at=excluded.started_at,
      ended_at=excluded.ended_at, model_main=excluded.model_main,
      session_kind=excluded.session_kind,
      net_tokens=excluded.net_tokens, cost_usd=excluded.cost_usd,
      cost_complete=excluded.cost_complete, report_json=excluded.report_json`);

  const selectScanKey = db.prepare(
    'SELECT transcript_path, file_mtime, file_size, scan_version FROM sessions WHERE id = ?');

  const upsertRec = db.prepare(`
    INSERT INTO recommendations (rule_id, subject, created_at, updated_at, last_seen_at, title,
      category, confidence, estimated_cost_usd, cost_basis, period_from, period_to,
      evidence_json, action, status, cost_at_status_usd)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'new', NULL)
    ON CONFLICT(rule_id, subject) DO UPDATE SET
      updated_at=excluded.updated_at, last_seen_at=excluded.last_seen_at,
      title=excluded.title, category=excluded.category, confidence=excluded.confidence,
      estimated_cost_usd=excluded.estimated_cost_usd, cost_basis=excluded.cost_basis,
      period_from=excluded.period_from, period_to=excluded.period_to,
      evidence_json=excluded.evidence_json, action=excluded.action`);

  return {
    close() { db.close(); },

    // Incremental key: an unchanged (path, mtime, size, scanVersion) quadruple
    // means the stored facts are still valid, so the session is not re-read.
    needsScan(ref, scanVersion) {
      const row = selectScanKey.get(ref.sessionId);
      if (!row) return true;
      return !(row.transcript_path === ref.mainPath
        && row.file_mtime === ref.mtime.getTime()
        && row.file_size === ref.sizeBytes
        && row.scan_version === scanVersion);
    },

    upsertSession(s) {
      insertSession.run(s.id, s.project, s.transcriptPath, s.fileMtime, s.fileSize,
        s.scanVersion, s.startedAt, s.endedAt, s.modelMain, s.sessionKind, s.netTokens, s.costUsd,
        s.costComplete ? 1 : 0, s.reportJson);
    },

    listSessions({ project, since, kinds } = {}) {
      const where = [];
      const args = [];
      if (project) { where.push('project = ?'); args.push(project); }
      if (since) { where.push('started_at >= ?'); args.push(since); }
      if (kinds) {
        where.push(`session_kind IN (${kinds.map(() => '?').join(',')})`);
        args.push(...kinds);
      }
      const sql = `SELECT * FROM sessions ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                   ORDER BY started_at DESC, id DESC`;
      return db.prepare(sql).all(...args).map(toSessionRow);
    },

    getSession(id) {
      const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
      return row ? toSessionRow(row) : null;
    },

    // Basis announcement (M1.1): every count the summary displays. NULL kind
    // (rows scanned before the migration) counts as unknown — never as human.
    countByKind({ since } = {}) {
      const args = [];
      let where = '';
      if (since) { where = 'WHERE started_at >= ?'; args.push(since); }
      const out = { interactive: 0, headless: 0, unknown: 0 };
      const rows = db.prepare(`SELECT COALESCE(session_kind, 'unknown') AS kind, COUNT(*) AS n
        FROM sessions ${where} GROUP BY kind`).all(...args);
      for (const row of rows) out[row.kind] = row.n;
      return out;
    },

    // The inventory is a snapshot, not a history: the latest scan replaces it
    // wholesale, so a removed MCP server disappears instead of lingering.
    replaceConfigItems(takenAt, items) {
      db.exec('DELETE FROM config_items');
      const ins = db.prepare(
        'INSERT INTO config_items (taken_at, kind, name, scope, detail_json) VALUES (?,?,?,?,?)');
      for (const it of items) ins.run(takenAt, it.kind, it.name, it.scope, JSON.stringify(it.detail));
    },

    listConfigItems() {
      return db.prepare('SELECT kind, name, scope, detail_json FROM config_items ORDER BY kind, name')
        .all()
        .map(r => ({ kind: r.kind, name: r.name, scope: r.scope, detail: JSON.parse(r.detail_json) }));
    },

    // Identity is (ruleId, subject) so a rescan refreshes the numbers without
    // ever resurrecting a decision the user already made. last_seen_at only
    // moves for recommendations the scan re-emitted; rows left behind keep
    // their older date and are NOT deleted — the ranking decides what a stale
    // date means, this module only records it.
    upsertRecommendations(recs, now) {
      for (const r of recs) {
        upsertRec.run(r.ruleId, r.subject, now, now, now, r.title, r.category, r.confidence,
          r.estimatedCostUsd, r.costBasis, r.periodFrom, r.periodTo,
          JSON.stringify(r.evidence), r.action);
      }
    },

    listRecommendations({ status } = {}) {
      const rows = status
        ? db.prepare('SELECT * FROM recommendations WHERE status = ? ORDER BY id').all(status)
        : db.prepare('SELECT * FROM recommendations ORDER BY id').all();
      return rows.map(toRecommendation);
    },

    // Freezes the cost at decision time — the baseline for the "+50 % before it
    // comes back" rule applied at ranking time.
    setRecommendationStatus(id, status, now) {
      const res = db.prepare(`UPDATE recommendations
        SET status = ?, updated_at = ?, cost_at_status_usd = estimated_cost_usd
        WHERE id = ?`).run(status, now, id);
      return res.changes > 0;
    },

    getScanState(claudeDir) {
      const row = db.prepare('SELECT last_scan_at, engine_version FROM scan_state WHERE claude_dir = ?')
        .get(claudeDir);
      return row ? { lastScanAt: row.last_scan_at, engineVersion: row.engine_version } : null;
    },

    setScanState(claudeDir, lastScanAt, engineVersion) {
      db.prepare(`INSERT INTO scan_state (claude_dir, last_scan_at, engine_version) VALUES (?,?,?)
        ON CONFLICT(claude_dir) DO UPDATE SET
          last_scan_at=excluded.last_scan_at, engine_version=excluded.engine_version`)
        .run(claudeDir, lastScanAt, engineVersion);
    },
  };
}

module.exports = { openStore };

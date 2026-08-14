'use strict';
// SQLite persistence for the observatory — metadata only, never content.
//
// The database is a disposable derivative: transcripts remain the source of
// truth, so deleting the file is safe (it rebuilds on the next scan). This
// module stores and reads; it holds no domain knowledge about what a churn
// cause, a ranking or a stale recommendation means.

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { applyMigrations } from './migrations.ts';
import type { ConfigItem, SessionKind } from './rules/types.ts';

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

// ─── Row shapes (camelCase, the store's public vocabulary) ─────────────────

// Exported: service.ts (lot 6, second real occurrence) builds its session-list
// and single-session public shapes on top of this exact row.
//
// Nullable beyond `id`: the SCHEMA above declares none of these columns
// NOT NULL (SQLite honours that literally), and a real M1 (pre-M1.1) database
// proves it — observatory-migrations.test.cjs inserts a row with only
// (id, project, scan_version) set, exactly the shape applyMigrations exists
// to tolerate. A stricter, non-null type here would make toSessionRow throw
// on a database this product explicitly promises to open without loss.
export interface SessionRow {
  id: string;
  project: string | null;
  transcriptPath: string | null;
  fileMtime: number | null;
  fileSize: number | null;
  scanVersion: number | null;
  startedAt: string | null;
  endedAt: string | null;
  modelMain: string | null;
  sessionKind: SessionKind | null;
  netTokens: number | null;
  costUsd: number | null;
  costComplete: boolean;
  reportJson: string | null;
}

interface RecommendationRow {
  id: number;
  ruleId: string;
  subject: string;
  title: string;
  category: string;
  confidence: string;
  estimatedCostUsd: number;
  costBasis: string;
  periodFrom: string | null;
  periodTo: string | null;
  evidence: Record<string, unknown>;
  action: string | null;
  status: 'new' | 'accepted' | 'ignored';
  createdAt: string;
  updatedAt: string;
  lastSeenAt: string | null;
  costAtStatusUsd: number | null;
}

interface RecommendationInput {
  ruleId: string;
  subject: string;
  title: string;
  category: string;
  confidence: string;
  estimatedCostUsd: number;
  costBasis: string;
  periodFrom: string;
  periodTo: string;
  // Opaque at the store boundary — the specific R1..R6 evidence shape lives
  // in rules/types.ts, which the store never needs to know.
  evidence: unknown;
  action: string | null;
}

interface KindCounts {
  interactive: number;
  headless: number;
  unknown: number;
}

interface ScanRef {
  sessionId: string;
  mainPath: string;
  mtime: Date;
  sizeBytes: number;
}

interface ScanState {
  lastScanAt: string;
  engineVersion: string;
}

export interface Store {
  close(): void;
  purge(): void;
  needsScan(ref: ScanRef, scanVersion: number): boolean;
  upsertSession(s: SessionRow): void;
  listSessions(opts?: { project?: string; since?: string; kinds?: SessionKind[] }): SessionRow[];
  getSession(id: string): SessionRow | null;
  countByKind(opts?: { since?: string }): KindCounts;
  replaceConfigItems(takenAt: string, items: ConfigItem[]): void;
  listConfigItems(): ConfigItem[];
  upsertRecommendations(recs: RecommendationInput[], now: string): void;
  listRecommendations(opts?: { status?: 'new' | 'accepted' | 'ignored' }): RecommendationRow[];
  setRecommendationStatus(id: number, status: string, now: string): boolean;
  getScanState(claudeDir: string): ScanState | null;
  setScanState(claudeDir: string, lastScanAt: string, engineVersion: string): void;
}

// ─── Narrowing the rows SQLite hands back — no assumed shape ───────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}
const isStringOrNull = (v: unknown): v is string | null => v === null || typeof v === 'string';
const isNumberOrNull = (v: unknown): v is number | null => v === null || typeof v === 'number';

interface SessionColumns {
  id: string; project: string | null; transcript_path: string | null;
  file_mtime: number | null; file_size: number | null; scan_version: number | null;
  started_at: string | null; ended_at: string | null; model_main: string | null;
  session_kind: string | null;
  net_tokens: number | null; cost_usd: number | null; cost_complete: number | null; report_json: string | null;
}

function isSessionColumns(v: unknown): v is SessionColumns {
  if (!isRecord(v)) return false;
  return typeof v.id === 'string'
    && isStringOrNull(v.project) && isStringOrNull(v.transcript_path)
    && isNumberOrNull(v.file_mtime) && isNumberOrNull(v.file_size) && isNumberOrNull(v.scan_version)
    && isStringOrNull(v.started_at) && isStringOrNull(v.ended_at)
    && isStringOrNull(v.model_main) && isStringOrNull(v.session_kind)
    && isNumberOrNull(v.net_tokens) && isNumberOrNull(v.cost_usd)
    && isNumberOrNull(v.cost_complete) && isStringOrNull(v.report_json);
}

// A row that fails to match is a genuine invariant violation — WE control
// both the schema and every write, so this is a trust boundary on our own
// data (same reasoning as session-mapper.ts's JSON.parse(...) cast), never
// silently patched with a guessed default.
function toSessionRow(v: unknown): SessionRow {
  if (!isSessionColumns(v)) throw new Error('observatory store: ligne "sessions" de forme inattendue');
  return {
    id: v.id, project: v.project, transcriptPath: v.transcript_path,
    fileMtime: v.file_mtime, fileSize: v.file_size, scanVersion: v.scan_version,
    startedAt: v.started_at, endedAt: v.ended_at, modelMain: v.model_main,
    sessionKind: v.session_kind as SessionKind | null,
    netTokens: v.net_tokens, costUsd: v.cost_usd, costComplete: v.cost_complete === 1,
    reportJson: v.report_json,
  };
}

const isStatus = (v: unknown): v is 'new' | 'accepted' | 'ignored' =>
  v === 'new' || v === 'accepted' || v === 'ignored';

interface RecommendationColumns {
  id: number; rule_id: string; subject: string; title: string; category: string;
  confidence: string; estimated_cost_usd: number; cost_basis: string;
  period_from: string | null; period_to: string | null;
  evidence_json: string; action: string | null; status: string;
  created_at: string; updated_at: string; last_seen_at: string | null;
  cost_at_status_usd: number | null;
}

function isRecommendationColumns(v: unknown): v is RecommendationColumns {
  if (!isRecord(v)) return false;
  return typeof v.id === 'number' && typeof v.rule_id === 'string' && typeof v.subject === 'string'
    && typeof v.title === 'string' && typeof v.category === 'string' && typeof v.confidence === 'string'
    && typeof v.estimated_cost_usd === 'number' && typeof v.cost_basis === 'string'
    && isStringOrNull(v.period_from) && isStringOrNull(v.period_to)
    && typeof v.evidence_json === 'string' && isStringOrNull(v.action) && typeof v.status === 'string'
    && typeof v.created_at === 'string' && typeof v.updated_at === 'string'
    && isStringOrNull(v.last_seen_at) && isNumberOrNull(v.cost_at_status_usd);
}

function toRecommendation(v: unknown): RecommendationRow {
  if (!isRecommendationColumns(v)) throw new Error('observatory store: ligne "recommendations" de forme inattendue');
  if (!isStatus(v.status)) throw new Error(`observatory store: statut de recommandation inattendu « ${v.status} »`);
  return {
    id: v.id, ruleId: v.rule_id, subject: v.subject,
    title: v.title, category: v.category, confidence: v.confidence,
    estimatedCostUsd: v.estimated_cost_usd, costBasis: v.cost_basis,
    periodFrom: v.period_from, periodTo: v.period_to,
    evidence: JSON.parse(v.evidence_json) as Record<string, unknown>,
    action: v.action,
    status: v.status, createdAt: v.created_at, updatedAt: v.updated_at,
    lastSeenAt: v.last_seen_at, costAtStatusUsd: v.cost_at_status_usd,
  };
}

function isConfigItemColumns(v: unknown): v is { kind: string; name: string; scope: string; detail_json: string } {
  if (!isRecord(v)) return false;
  return typeof v.kind === 'string' && typeof v.name === 'string' && typeof v.scope === 'string'
    && typeof v.detail_json === 'string';
}

function toConfigItem(v: unknown): ConfigItem {
  if (!isConfigItemColumns(v)) throw new Error('observatory store: ligne "config_items" de forme inattendue');
  return { kind: v.kind, name: v.name, scope: v.scope, detail: JSON.parse(v.detail_json) };
}

function isScanKeyColumns(v: unknown): v is {
  transcript_path: string; file_mtime: number; file_size: number; scan_version: number;
} {
  if (!isRecord(v)) return false;
  return typeof v.transcript_path === 'string' && typeof v.file_mtime === 'number'
    && typeof v.file_size === 'number' && typeof v.scan_version === 'number';
}

function isScanStateColumns(v: unknown): v is { last_scan_at: string; engine_version: string } {
  if (!isRecord(v)) return false;
  return typeof v.last_scan_at === 'string' && typeof v.engine_version === 'string';
}

function isKindCountRow(v: unknown): v is { kind: string; n: number } {
  if (!isRecord(v)) return false;
  return typeof v.kind === 'string' && typeof v.n === 'number';
}

function openStore(dbPath: string): Store {
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
    close(): void { db.close(); },

    // The file deletion the README documents, done from inside the open
    // database: the derivative is disposable, only recommendation statuses
    // are lost. SQL DELETE, never file removal — Windows locks the open file.
    purge(): void {
      db.exec(
        'DELETE FROM sessions; DELETE FROM config_items; DELETE FROM recommendations; DELETE FROM scan_state;');
    },

    // Incremental key: an unchanged (path, mtime, size, scanVersion) quadruple
    // means the stored facts are still valid, so the session is not re-read.
    needsScan(ref: ScanRef, scanVersion: number): boolean {
      const row = selectScanKey.get(ref.sessionId);
      if (!isScanKeyColumns(row)) return true;
      return !(row.transcript_path === ref.mainPath
        && row.file_mtime === ref.mtime.getTime()
        && row.file_size === ref.sizeBytes
        && row.scan_version === scanVersion);
    },

    upsertSession(s: SessionRow): void {
      insertSession.run(s.id, s.project, s.transcriptPath, s.fileMtime, s.fileSize,
        s.scanVersion, s.startedAt, s.endedAt, s.modelMain, s.sessionKind, s.netTokens, s.costUsd,
        s.costComplete ? 1 : 0, s.reportJson);
    },

    listSessions(opts: { project?: string; since?: string; kinds?: SessionKind[] } = {}): SessionRow[] {
      const { project, since, kinds } = opts;
      const where: string[] = [];
      const args: Array<string | number> = [];
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

    getSession(id: string): SessionRow | null {
      const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
      return row ? toSessionRow(row) : null;
    },

    // Basis announcement (M1.1): every count the summary displays. NULL kind
    // (rows scanned before the migration) counts as unknown — never as human.
    countByKind(opts: { since?: string } = {}): KindCounts {
      const { since } = opts;
      const args: string[] = [];
      let where = '';
      if (since) { where = 'WHERE started_at >= ?'; args.push(since); }
      const out: KindCounts = { interactive: 0, headless: 0, unknown: 0 };
      const rows = db.prepare(`SELECT COALESCE(session_kind, 'unknown') AS kind, COUNT(*) AS n
        FROM sessions ${where} GROUP BY kind`).all(...args);
      for (const row of rows) {
        if (!isKindCountRow(row)) continue;
        if (row.kind === 'interactive' || row.kind === 'headless' || row.kind === 'unknown') out[row.kind] = row.n;
      }
      return out;
    },

    // The inventory is a snapshot, not a history: the latest scan replaces it
    // wholesale, so a removed MCP server disappears instead of lingering.
    replaceConfigItems(takenAt: string, items: ConfigItem[]): void {
      db.exec('DELETE FROM config_items');
      const ins = db.prepare(
        'INSERT INTO config_items (taken_at, kind, name, scope, detail_json) VALUES (?,?,?,?,?)');
      for (const it of items) ins.run(takenAt, it.kind, it.name, it.scope, JSON.stringify(it.detail));
    },

    listConfigItems(): ConfigItem[] {
      return db.prepare('SELECT kind, name, scope, detail_json FROM config_items ORDER BY kind, name')
        .all()
        .map(toConfigItem);
    },

    // Identity is (ruleId, subject) so a rescan refreshes the numbers without
    // ever resurrecting a decision the user already made. last_seen_at only
    // moves for recommendations the scan re-emitted; rows left behind keep
    // their older date and are NOT deleted — the ranking decides what a stale
    // date means, this module only records it.
    upsertRecommendations(recs: RecommendationInput[], now: string): void {
      for (const r of recs) {
        upsertRec.run(r.ruleId, r.subject, now, now, now, r.title, r.category, r.confidence,
          r.estimatedCostUsd, r.costBasis, r.periodFrom, r.periodTo,
          JSON.stringify(r.evidence), r.action);
      }
    },

    listRecommendations(opts: { status?: 'new' | 'accepted' | 'ignored' } = {}): RecommendationRow[] {
      const { status } = opts;
      const rows = status
        ? db.prepare('SELECT * FROM recommendations WHERE status = ? ORDER BY id').all(status)
        : db.prepare('SELECT * FROM recommendations ORDER BY id').all();
      return rows.map(toRecommendation);
    },

    // Freezes the cost at decision time — the baseline for the "+50 % before it
    // comes back" rule applied at ranking time.
    setRecommendationStatus(id: number, status: string, now: string): boolean {
      const res = db.prepare(`UPDATE recommendations
        SET status = ?, updated_at = ?, cost_at_status_usd = estimated_cost_usd
        WHERE id = ?`).run(status, now, id);
      return res.changes > 0;
    },

    getScanState(claudeDir: string): ScanState | null {
      const row = db.prepare('SELECT last_scan_at, engine_version FROM scan_state WHERE claude_dir = ?')
        .get(claudeDir);
      return isScanStateColumns(row) ? { lastScanAt: row.last_scan_at, engineVersion: row.engine_version } : null;
    },

    setScanState(claudeDir: string, lastScanAt: string, engineVersion: string): void {
      db.prepare(`INSERT INTO scan_state (claude_dir, last_scan_at, engine_version) VALUES (?,?,?)
        ON CONFLICT(claude_dir) DO UPDATE SET
          last_scan_at=excluded.last_scan_at, engine_version=excluded.engine_version`)
        .run(claudeDir, lastScanAt, engineVersion);
    },
  };
}

export { openStore };

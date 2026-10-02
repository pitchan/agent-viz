// Lit les jetons d'une conversation Antigravity dans sa base SQLite, sans rien écrire chez agy.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { decodeGenMetadata } from './antigravity-usage.ts';
import type { UsageSnapshot, UsageSnapshotSource } from './types.ts';

// Le transcript est sous <racine>/brain/<conversation>/.system_generated/logs/ ;
// la base de la même conversation est <racine>/conversations/<conversation>.db.
function databasePath(transcriptPath: string): string {
  const conversationDir = path.dirname(path.dirname(path.dirname(transcriptPath)));
  const root = path.dirname(path.dirname(conversationDir));
  return path.join(root, 'conversations', `${path.basename(conversationDir)}.db`);
}

function fileStamp(file: string): string {
  try {
    const s = fs.statSync(file);
    return `${s.size}:${s.mtimeMs}`;
  } catch {
    return '-';
  }
}

// La base seule ne suffit pas : pendant une session, les lignes récentes sont dans son journal.
function stamp(transcriptPath: string): string | null {
  const db = databasePath(transcriptPath);
  if (!fs.existsSync(db)) return null;
  return `${fileStamp(db)}|${fileStamp(`${db}-wal`)}`;
}

function isBlobRow(row: unknown): row is { idx: number; data: Uint8Array } {
  if (typeof row !== 'object' || row === null) return false;
  return 'idx' in row && typeof row.idx === 'number' && 'data' in row && row.data instanceof Uint8Array;
}

// Ouvrir la base d'agy sur place, même en lecture seule, crée des fichiers `-shm` et `-wal`
// à côté d'elle : la lecture se fait sur une copie, base et journal, dans un dossier temporaire.
function read(transcriptPath: string): UsageSnapshot {
  const source = databasePath(transcriptPath);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-viz-agy-'));
  try {
    const copy = path.join(dir, 'conversation.db');
    fs.copyFileSync(source, copy);
    if (fs.existsSync(`${source}-wal`)) fs.copyFileSync(`${source}-wal`, `${copy}-wal`);
    const db = new DatabaseSync(copy);
    let rows: unknown[];
    try {
      rows = db.prepare('SELECT idx, data FROM gen_metadata ORDER BY idx').all();
    } finally {
      db.close();
    }
    const calls = [];
    for (const row of rows) {
      if (!isBlobRow(row)) return { ok: false, reason: 'ligne gen_metadata sans bloc' };
      const decoded = decodeGenMetadata(row.data);
      if (!decoded.ok) return { ok: false, reason: `appel ${row.idx} : ${decoded.reason}` };
      calls.push({ id: decoded.id, model: decoded.model, usage: decoded.usage });
    }
    return { ok: true, calls };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export const antigravityUsageSnapshot: UsageSnapshotSource = { stamp, read };
export const _internals = { databasePath };

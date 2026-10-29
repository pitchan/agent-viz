'use strict';
// Periodic maintenance — purge old/empty sessions, compact large files,
// drop fs.watch handles for sessions older than the watch window, the
// initial scan-and-watch sweep at boot, and the events-dir watcher's handler
// for session files that appear or change after that sweep.

import fs from 'node:fs';
const fsp = fs.promises;
import path from 'node:path';

import {
  DIR,
  PURGE_MAX_AGE_MS, PURGE_KEEP_MAX,
  EMPTY_THRESHOLD_BYTES, EMPTY_MAX_AGE_MS,
  WATCH_WINDOW_MS,
  COMPACT_THRESHOLD_BYTES, COMPACT_KEEP_EVENTS,
  sessionIndex,
  idFromPath, indexSessionInitial,
} from './session-index.ts';
import { broadcastSessionsChanged } from './sse.ts';
import {
  watchSession, unwatchSession, isWatched, rebaseFileOffset, deleteSession,
  readAndBroadcast,
} from './event-reader.ts';
import { ensureTranscriptWatcher } from './transcript.ts';
import { decodeJsonlLine } from '../engine/core/jsonl.ts';

// Un objet exploitable par accès de champ — même garde locale que
// session-index.ts et les adaptateurs de transcript : `decodeJsonlLine` ne
// promet qu'un JSON valide, pas un objet.
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function countNewlines(buf: Buffer): number {
  let n = 0;
  for (const b of buf) if (b === 0x0a) n++;
  return n;
}

interface CompactedTool {
  name: unknown;
  id: unknown;
  event: 'PreToolUse' | 'PostToolUse' | 'PostToolUseFailure';
  ts: unknown;
}

interface SessionSummary {
  id: string;
  compactedAt: string;
  totalEvents: number;
  tools: CompactedTool[];
  prompt: unknown;
}

// For large files: read all events, keep the last COMPACT_KEEP_EVENTS, write a
// companion .summary.json with session metadata, then rewrite the JSONL.
// `readFile` is injected so a test can make the hook write between the read and the rewrite.
async function compactSession(
  fp: string,
  readFile: (p: string) => Promise<string> = p => fsp.readFile(p, 'utf8'),
): Promise<void> {
  const id = idFromPath(fp);
  const rec = sessionIndex.get(id);
  if (!rec) return;
  let content: string;
  try { content = await readFile(fp); } catch { return; }
  const allLines = content.trim().split('\n');
  if (allLines.length <= COMPACT_KEEP_EVENTS) return;

  // Build summary from the full history before we throw away old lines.
  const summary: SessionSummary = { id, compactedAt: new Date().toISOString(), totalEvents: allLines.length, tools: [], prompt: rec.promptCache || null };
  for (const line of allLines) {
    // Le verdict sur une ligne vient de la primitive du moteur : une ligne préfixée
    // d'un BOM est décodée où qu'elle se trouve, et pas seulement en tête du fichier,
    // là où `content.trim()` ci-dessus la nettoie.
    const verdict = decodeJsonlLine(line);
    if (!verdict || !verdict.ok) continue;
    const evt = verdict.value;
    if (!isRecord(evt)) continue;
    const e = evt.hook_event_name;
    if (e === 'PreToolUse' || e === 'PostToolUse' || e === 'PostToolUseFailure') {
      summary.tools.push({ name: evt.tool_name, id: evt.tool_use_id, event: e, ts: evt._ts });
    }
  }

  // Keep only the tail.
  const kept = allLines.slice(-COMPACT_KEEP_EVENTS);
  const summaryPath = fp.replace('.jsonl', '.summary.json');
  try {
    await fsp.writeFile(summaryPath, JSON.stringify(summary, null, 2));
    // Synchrone jusqu'au nouveau curseur : ce que le hook a écrit depuis la lecture
    // est recopié, et aucune lecture vive ne démarre entre la réécriture et le curseur.
    const sizeBefore = fs.statSync(fp).size;
    const readBytes = Buffer.byteLength(content);
    const appended = Buffer.alloc(sizeBefore - readBytes);
    const fd = fs.openSync(fp, 'r');
    try { fs.readSync(fd, appended, 0, appended.length, readBytes); } finally { fs.closeSync(fd); }
    const rewritten = Buffer.concat([Buffer.from(kept.join('\n') + '\n'), appended]);
    fs.writeFileSync(fp, rewritten);
    // L'index compte ce que le lecteur a déjà lu : il reprend là où le curseur reprend.
    const offset = rebaseFileOffset(fp, sizeBefore, rewritten.length);
    rec.size = offset;
    rec.eventCount = countNewlines(rewritten.subarray(0, offset));
    console.log(`[housekeep] compacted ${id}: ${allLines.length} → ${kept.length} events, summary at ${path.basename(summaryPath)}`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[housekeep] compact failed for ${id}:`, message);
  }
}

interface SessionFileEntry {
  fp: string;
  id: string;
  size: number;
  mtime: number;
}

async function housekeep(): Promise<void> {
  const now = Date.now();

  // Stat all session files.
  const entries: SessionFileEntry[] = [];
  let files: string[];
  try { files = (await fsp.readdir(DIR)).filter(f => f.endsWith('.jsonl')); }
  catch { files = []; }
  for (const f of files) {
    const fp = path.join(DIR, f);
    const id = idFromPath(fp);
    let stat;
    try { stat = await fsp.stat(fp); } catch { continue; }
    entries.push({ fp, id, size: stat.size, mtime: stat.mtimeMs });
  }

  // Sort by mtime descending (newest first) for the keep-max logic.
  entries.sort((a, b) => b.mtime - a.mtime);

  let deleted = 0, unwatched = 0, compacted = 0;

  // `entries()` plutôt qu'un accès indexé : `noUncheckedIndexedAccess` rendrait
  // `entries[i]` possiblement `undefined` alors que la borne de la boucle le garantit.
  for (const [i, entry] of entries.entries()) {
    const { fp, size, mtime } = entry;
    const age = now - mtime;

    // Rule C: empty/aborted sessions (≤ 1 KB, older than 1 h) → delete.
    if (size <= EMPTY_THRESHOLD_BYTES && age > EMPTY_MAX_AGE_MS) {
      await deleteSession(fp);
      deleted++;
      continue;
    }

    // Rule A: sessions older than PURGE_MAX_AGE_MS → delete.
    if (age > PURGE_MAX_AGE_MS) {
      await deleteSession(fp);
      deleted++;
      continue;
    }

    // Rule A: keep only the N most recent. Index i is 0-based from newest.
    if (PURGE_KEEP_MAX > 0 && i >= PURGE_KEEP_MAX) {
      await deleteSession(fp);
      deleted++;
      continue;
    }

    // Rule B: compact large files.
    if (size > COMPACT_THRESHOLD_BYTES) {
      await compactSession(fp);
      compacted++;
    }

    // Rule D: lazy-watch. Only watch files from the last WATCH_WINDOW_MS.
    if (age > WATCH_WINDOW_MS) {
      if (isWatched(fp)) {
        unwatchSession(fp);
        unwatched++;
      }
      // Keep in sessionIndex — the session card is still shown in the UI,
      // it just won't receive live updates (it's finished anyway).
    }
  }

  if (deleted || unwatched || compacted) {
    console.log(`[housekeep] deleted=${deleted} unwatched=${unwatched} compacted=${compacted} remaining=${sessionIndex.size}`);
    broadcastSessionsChanged();
  }
}

// Watch existing files + new files.
async function scanAndWatch(): Promise<void> {
  let files: string[];
  try { files = (await fsp.readdir(DIR)).filter(f => f.endsWith('.jsonl')); }
  catch { return; }
  for (const f of files) {
    const fp = path.join(DIR, f);
    await indexSessionInitial(fp);
    const rec = sessionIndex.get(idFromPath(fp));
    if (rec && (Date.now() - rec.mtime) < WATCH_WINDOW_MS) {
      watchSession(fp);
      ensureTranscriptWatcher(fp).catch(err => console.error(`[housekeep] ensureTranscriptWatcher ${rec.id.slice(0, 8)} failed: ${err.message}`));
    }
  }
}

// Rattrape le disque sans vider la liste : une session connue garde son enregistrement et ses
// watchers, donc un événement écrit pendant la reconstruction n'est ni perdu ni rejoué.
async function rescanSessions(): Promise<void> {
  for (const id of [...sessionIndex.keys()]) {
    const fp = path.join(DIR, `${id}.jsonl`);
    if (!fs.existsSync(fp)) await deleteSession(fp);
  }
  await scanAndWatch();
}

// Handler of the events-dir watcher, armed after the initial index: a file the
// index does not know is new, and its first lines are already on disk when the
// event arrives, so they are read now rather than at the next write.
async function sessionFileChanged(fp: string): Promise<void> {
  if (!fs.existsSync(fp)) return;
  const id = idFromPath(fp);
  if (!sessionIndex.has(id)) {
    sessionIndex.set(id, {
      id, promptCache: undefined, promptWindow: 0,
      eventCount: 0, size: 0, mtime: Date.now(),
      agentSource: undefined,
    });
    broadcastSessionsChanged();
  }
  if (isWatched(fp)) return;
  watchSession(fp);
  await readAndBroadcast(fp);
}

export { compactSession, housekeep, rescanSessions, scanAndWatch, sessionFileChanged };

'use strict';
// Periodic maintenance — purge old/empty sessions, compact large files,
// drop fs.watch handles for sessions older than the watch window, and the
// initial scan-and-watch sweep at boot.

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
  watchSession, unwatchSession, isWatched, resetFileOffset, deleteSession,
} from './event-reader.ts';
import { ensureTranscriptWatcher } from './transcript.ts';
import { decodeJsonlLine } from './jsonl.ts';

// Un objet exploitable par accès de champ — même garde locale que
// session-index.ts et les adaptateurs de transcript : `decodeJsonlLine` ne
// promet qu'un JSON valide, pas un objet.
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
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
async function compactSession(fp: string): Promise<void> {
  const id = idFromPath(fp);
  const rec = sessionIndex.get(id);
  if (!rec) return;
  let content: string;
  try { content = await fsp.readFile(fp, 'utf8'); } catch { return; }
  const allLines = content.trim().split('\n');
  if (allLines.length <= COMPACT_KEEP_EVENTS) return;

  // Build summary from the full history before we throw away old lines.
  const summary: SessionSummary = { id, compactedAt: new Date().toISOString(), totalEvents: allLines.length, tools: [], prompt: rec.promptCache || null };
  for (const line of allLines) {
    // C2 : le verdict sur une ligne vient de la primitive commune du moteur, il
    // n'est plus réimplémenté ici. Conséquence assumée : une ligne préfixée d'un
    // BOM est désormais décodée au lieu d'être perdue, où qu'elle se trouve dans
    // le fichier — avant, seule celle en toute première position survivait, et
    // par accident, parce que le `content.trim()` ci-dessus la nettoyait.
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
    await fsp.writeFile(fp, kept.join('\n') + '\n');
    // Update index to reflect new file size.
    const stat = await fsp.stat(fp);
    rec.size = stat.size;
    rec.eventCount = kept.length;
    // Reset the read offset so readAndBroadcast doesn't skip the new smaller file.
    resetFileOffset(fp, stat.size);
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

  // `entries()` plutôt qu'un accès indexé : `noUncheckedIndexedAccess`
  // rendrait `entries[i]` possiblement `undefined`, alors que la borne de la
  // boucle le garantit toujours défini — même geste qu'en lot 8 ailleurs
  // (prompt-install.ts) pour la même raison.
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

export { compactSession, housekeep, scanAndWatch };

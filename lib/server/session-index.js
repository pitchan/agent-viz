'use strict';
// In-memory session registry + path/id validation + initial indexing.
//
// Owns the canonical session record shape. Transcript and token modules attach
// their own private fields lazily on the same record (documented below).
//
// Record fields owned here:
//   id, eventCount, size, mtime, agentSource, promptCache, promptWindow
// Fields attached by transcript.js (lazy):
//   transcriptPath, transcriptOffset, transcriptLeftover, transcriptWatcher,
//   _transcriptReadInFlight, _transcriptReadPending, _transcriptWatchTimer,
//   _transcriptDiscoveryFailed
// Fields attached by tokens.js (lazy):
//   tokens, _tokensBroadcastTimer

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');

const DIR = path.join(os.tmpdir(), 'agent-events');
// Legacy dir from agent-viz < 0.2.0 (read-only — drop at v0.4.0).
const LEGACY_DIR = path.join(os.tmpdir(), 'claude-events');
try { fs.mkdirSync(DIR, { recursive: true }); } catch {}

// ── Housekeeping config (overridable via env) ──
// Sessions older than this are deleted on boot + every hour.
const PURGE_MAX_AGE_MS = parseInt(process.env.VIZ_PURGE_AGE_H || '24', 10) * 3600_000;
// Max sessions to keep (most recent by mtime). 0 = no limit.
const PURGE_KEEP_MAX = parseInt(process.env.VIZ_KEEP_MAX || '20', 10);
// Sessions ≤ this size AND older than 1 h are considered empty/aborted → purge.
const EMPTY_THRESHOLD_BYTES = 1024;
const EMPTY_MAX_AGE_MS = 3600_000;
// Only watch files modified in the last N hours. Older ones stay in sessionIndex
// but don't consume an fs.watch handle.
const WATCH_WINDOW_MS = 2 * 3600_000;
// Files larger than this get compacted (keep only last N events + summary).
const COMPACT_THRESHOLD_BYTES = parseInt(process.env.VIZ_COMPACT_KB || '500', 10) * 1024;
const COMPACT_KEEP_EVENTS = 100;

// id → record
const sessionIndex = new Map();
// sid → dir the session file lives in (DIR or LEGACY_DIR).
const sessionDirs = new Map();

function sessionFilePath(sid) {
  const dir = sessionDirs.get(sid) || DIR;
  return path.join(dir, sid + '.jsonl');
}

function idFromPath(fp) { return path.basename(fp, '.jsonl'); }

// Session IDs come from Claude Code (UUID) or fall back to "unknown" in hook.js.
// We restrict to safe filename chars to prevent path traversal via crafted ?session=
// or ?clear= values being concatenated into path.join(DIR, sid + '.jsonl').
function validSessionId(sid) {
  return typeof sid === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(sid);
}

// Stream-count newlines without loading the whole file into a string.
function countNewlinesStreaming(fp) {
  return new Promise((resolve) => {
    let count = 0;
    const stream = fs.createReadStream(fp);
    stream.on('data', buf => {
      for (let i = 0; i < buf.length; i++) if (buf[i] === 0x0a) count++;
    });
    stream.on('end', () => resolve(count));
    stream.on('error', () => resolve(0));
  });
}

async function indexSessionInitial(fp) {
  const id = idFromPath(fp);
  if (sessionIndex.has(id)) return;
  try {
    const stat = await fsp.stat(fp);
    const eventCount = await countNewlinesStreaming(fp);
    // Backfill agentSource from the first event's _source field (read first 4 KB).
    // Defaults to 'claude' for legacy events that lack the field.
    let agentSource = 'claude';
    try {
      const fh = await fsp.open(fp, 'r');
      const buf = Buffer.alloc(Math.min(4096, stat.size));
      await fh.read(buf, 0, buf.length, 0);
      await fh.close();
      const firstLine = buf.toString('utf8').split('\n')[0];
      const evt = firstLine ? JSON.parse(firstLine) : null;
      if (evt && typeof evt._source === 'string') agentSource = evt._source;
    } catch {}
    sessionIndex.set(id, {
      id,
      promptCache: undefined,
      promptWindow: 0,
      eventCount,
      size: stat.size,
      mtime: stat.mtimeMs,
      agentSource,
    });
    sessionDirs.set(id, path.dirname(fp));
  } catch {}
}

function touchIndex(fp, sizeDelta, newlineDelta) {
  const id = idFromPath(fp);
  let rec = sessionIndex.get(id);
  if (!rec) {
    rec = { id, promptCache: undefined, promptWindow: 0, eventCount: 0, size: 0, mtime: Date.now(), agentSource: undefined };
    sessionIndex.set(id, rec);
  }
  rec.size += sizeDelta;
  rec.eventCount += newlineDelta;
  rec.mtime = Date.now();
  if (!sessionDirs.has(id)) sessionDirs.set(id, path.dirname(fp));
}

function latestSession() {
  let latest = null, latestMtime = 0;
  for (const rec of sessionIndex.values()) {
    if (rec.mtime > latestMtime) { latestMtime = rec.mtime; latest = rec.id; }
  }
  return latest ? sessionFilePath(latest) : null;
}

module.exports = {
  DIR, LEGACY_DIR,
  PURGE_MAX_AGE_MS, PURGE_KEEP_MAX,
  EMPTY_THRESHOLD_BYTES, EMPTY_MAX_AGE_MS,
  WATCH_WINDOW_MS,
  COMPACT_THRESHOLD_BYTES, COMPACT_KEEP_EVENTS,
  sessionIndex, sessionDirs,
  sessionFilePath, idFromPath, validSessionId,
  countNewlinesStreaming, indexSessionInitial, touchIndex,
  latestSession,
};

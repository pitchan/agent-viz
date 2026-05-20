'use strict';
// Transcript reader — locates a session's transcript via the per-agent
// adapter, scans for the first user prompt (cached), and tails the main
// transcript plus every sub-agent transcript (<session>/subagents/agent-*.jsonl)
// for events that adapters convert into per-bucket token usage.

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const { sessionIndex, idFromPath } = require('./session-index');
const { ensureTokens, scheduleTokensBroadcast, tokenSum } = require('./tokens');
const { broadcastSessionsChanged } = require('./sse');
const { getAdapter } = require('./transcript-adapters');

// Read the first complete line of a file, however large. Streams in chunks
// and stops at the first '\n' — bounded by the line's length, not the file
// size. `cap` guards against a file with no newline at all (a single hook
// event past this size is pathological; return what was read so the caller's
// JSON.parse fails loudly rather than hanging).
function readFirstLine(filePath, cap = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
    let acc = '';
    stream.on('data', chunk => {
      acc += chunk;
      const nl = acc.indexOf('\n');
      if (nl !== -1) { stream.destroy(); resolve(acc.slice(0, nl)); }
      else if (acc.length > cap) { stream.destroy(); resolve(acc); }
    });
    stream.on('end', () => resolve(acc)); // single line, no trailing '\n'
    stream.on('error', reject);
  });
}

// Read the first event of a session file and ask the per-agent adapter where
// the transcript lives. Adapters know whether their source stamps
// `transcript_path` on the first event. The first line is read in full
// regardless of size — a long UserPromptSubmit event can push it well past
// any fixed buffer, and `transcript_path` sits at its end.
async function getTranscriptPath(sessionFile) {
  try {
    const firstLine = await readFirstLine(sessionFile);
    if (!firstLine) {
      console.error(`[transcript] ${idFromPath(sessionFile).slice(0, 8)}: empty session file — cannot extract transcript_path`);
      return null;
    }
    const evt = JSON.parse(firstLine);
    const adapter = getAdapter(evt && evt._source);
    return adapter.discoverPath(evt);
  } catch (err) {
    console.error(`[transcript] ${idFromPath(sessionFile).slice(0, 8)}: getTranscriptPath failed — ${err.message}`);
    return null;
  }
}

// ── Prompt extraction ──

// Strip tagged blocks (<tag>content</tag>) and standalone tags, then trim.
function cleanUserText(raw) {
  return raw.replace(/<(\w[\w-]*)[\s>][\s\S]*?<\/\1>/g, '').replace(/<[^>]+>/g, '').trim();
}

// Check if text is IDE/system noise rather than a real user prompt.
function isNoise(text) {
  return /^(The user (opened|is viewing|has selected|scrolled)|ide_selection|gitStatus:|Current branch:)/i.test(text);
}

// Extract the first real user prompt from a transcript buffer.
function extractPromptFromText(content) {
  const lines = content.split('\n');
  for (const line of lines) {
    try {
      const o = JSON.parse(line);
      if (o.type === 'user' || o.type === 'human') {
        const c = (o.message && o.message.content) || o.content;
        if (typeof c === 'string') {
          const clean = cleanUserText(c);
          if (clean && clean.length > 5 && !isNoise(clean)) return clean.slice(0, 120);
        }
        if (Array.isArray(c)) {
          for (const block of c) {
            if (block.type === 'text') {
              const text = cleanUserText(block.text);
              if (text && text.length > 5 && !text.startsWith('{') && !isNoise(text)) return text.slice(0, 120);
            }
          }
        }
      }
    } catch {}
  }
  return null;
}

// Stream up to `maxBytes` from the transcript and try to extract the first
// user prompt. Returns null if not found in the window, string otherwise.
async function readPromptBounded(transcriptPath, maxBytes) {
  return new Promise((resolve) => {
    const chunks = [];
    let total = 0;
    const stream = fs.createReadStream(transcriptPath, { end: maxBytes - 1 });
    stream.on('data', buf => { chunks.push(buf); total += buf.length; });
    stream.on('end', () => {
      try {
        const text = Buffer.concat(chunks, total).toString('utf8');
        resolve(extractPromptFromText(text));
      } catch { resolve(null); }
    });
    stream.on('error', () => resolve(null));
  });
}

// Lazy, cached, bounded first-prompt reader. Fire-and-forget friendly.
async function ensureFirstPrompt(sessionFile) {
  const id = idFromPath(sessionFile);
  const rec = sessionIndex.get(id);
  if (!rec) return null;
  if (typeof rec.promptCache === 'string') return rec.promptCache;
  const tp = await getTranscriptPath(sessionFile);
  if (!tp) { rec.promptCache = null; return null; }
  try { await fsp.access(tp); } catch { rec.promptCache = null; return null; }

  // First attempt: 256 KB. Widen to 1 MB on miss.
  const windows = [256 * 1024, 1024 * 1024];
  const start = rec.promptWindow ? windows.findIndex(w => w > rec.promptWindow) : 0;
  for (let i = Math.max(0, start); i < windows.length; i++) {
    const w = windows[i];
    rec.promptWindow = w;
    const prompt = await readPromptBounded(tp, w);
    if (prompt) {
      rec.promptCache = prompt;
      broadcastSessionsChanged();
      return prompt;
    }
  }
  rec.promptCache = null;
  return null;
}

// ── Token-usage transcript tailing ──

// Dispatch a single transcript line to the per-agent adapter. Returns true
// when a token bucket was updated.
function parseTranscriptEvent(line, rec) {
  return getAdapter(rec.agentSource).parseUsageLine(line, rec);
}

// A "tail" tracks the append-only streaming of one JSONL file. A session has
// one tail for its main transcript plus one per discovered sub-agent
// transcript — same read/watch machinery for both, since each parsed line is
// self-describing (it carries isSidechain + agentId) and routes itself to the
// right token bucket.
function makeTail(filePath) {
  return {
    path: filePath, offset: 0, leftover: '',
    watcher: null,
    _readInFlight: false, _readPending: false, _watchTimer: null,
  };
}

// Lazy initializer for the transcript slice on the session record. Holds the
// main transcript tail plus a per-sub-agent tail map under a single namespace
// so transcript.js doesn't stamp loose fields onto the shared record object.
function ensureTranscriptSlice(rec) {
  if (!rec.transcript) {
    rec.transcript = {
      main: null,             // tail | null
      subagents: new Map(),   // agentId → tail
      _mainPending: false, _closed: false,
    };
  }
  return rec.transcript;
}

// Append-only streaming read of one tail's file. Preserves a line leftover for
// partial trailing writes. Same concurrency guard pattern as readAndBroadcast.
// `_closed` short-circuit guards against the race where deleteSession fires
// between the fs.watch debounce timer being scheduled (50ms) and it firing —
// without it we'd parse bytes into a `rec` already removed from sessionIndex
// and emit a stray SSE for a session the client just discarded.
async function readTailDelta(tail, rec) {
  const tr = rec.transcript;
  if (!tr || tr._closed) return;
  if (tail._readInFlight) { tail._readPending = true; return; }
  tail._readInFlight = true;
  let fh;
  try {
    const stat = await fsp.stat(tail.path);
    const offset = tail.offset || 0;
    if (stat.size <= offset) return;
    const len = stat.size - offset;
    const buf = Buffer.alloc(len);
    fh = await fsp.open(tail.path, 'r');
    await fh.read(buf, 0, len, offset);
    await fh.close();
    fh = null;
    tail.offset = stat.size;
    const text = (tail.leftover || '') + buf.toString('utf8');
    const lines = text.split('\n');
    tail.leftover = lines.pop(); // possibly incomplete tail
    let changed = false;
    for (const line of lines) {
      if (!line) continue;
      if (parseTranscriptEvent(line, rec)) changed = true;
    }
    if (changed) scheduleTokensBroadcast(rec.id, rec);
  } catch {
    if (fh) { try { await fh.close(); } catch {} }
  } finally {
    tail._readInFlight = false;
    if (tail._readPending) {
      tail._readPending = false;
      setImmediate(() => readTailDelta(tail, rec).catch(err => console.error(`[transcript] ${rec.id.slice(0, 8)}: re-read failed: ${err.message}`)));
    }
  }
}

// Open an fs.watch on a tail's file for live updates, debounced 50ms (Windows
// fires multiple change events per write). A file that can't be watched must
// not abort the rest of the session's token tracking.
function watchTail(tail, rec) {
  try {
    tail.watcher = fs.watch(tail.path, () => {
      if (tail._watchTimer) clearTimeout(tail._watchTimer);
      tail._watchTimer = setTimeout(() => {
        tail._watchTimer = null;
        readTailDelta(tail, rec).catch(err => console.error(`[transcript] ${rec.id.slice(0, 8)}: watch read failed: ${err.message}`));
      }, 50);
    });
  } catch { /* unwatched file → its tokens just stop updating live */ }
}

// Sub-agent transcripts live next to the main one:
//   <dir>/<sessionBasename>/subagents/agent-<agentId>.jsonl
// Claude Code (≥ ~2.1.143) no longer inlines sub-agent activity in the parent
// transcript — each sub-agent gets its own file. Re-scanned on every call so
// agents spawned mid-session are picked up shortly after their first event;
// already-tracked files are skipped. The discovery loop registers each new
// tail synchronously (no await in its body) so concurrent callers can't
// double-register the same file.
async function ensureSubagentTails(tr, rec) {
  if (!tr.main) return;
  const mainPath = tr.main.path;
  const subDir = path.join(
    path.dirname(mainPath),
    path.basename(mainPath, '.jsonl'),
    'subagents',
  );
  let files;
  try { files = await fsp.readdir(subDir); }
  catch { return; } // no subagents/ dir → session has no sub-agents (yet)
  const fresh = [];
  for (const f of files) {
    const m = /^agent-(.+)\.jsonl$/.exec(f);
    if (!m) continue;
    const agentId = m[1];
    if (tr.subagents.has(agentId)) continue;
    const tail = makeTail(path.join(subDir, f));
    tr.subagents.set(agentId, tail);
    watchTail(tail, rec);
    fresh.push(tail);
  }
  await Promise.all(fresh.map(t => readTailDelta(t, rec)));
}

// Discover the main transcript_path, do an initial full-file read to catch up,
// open fs.watch for live updates, then discover + tail any sub-agent
// transcripts. The main-transcript half runs once (guarded by `_mainPending`
// against overlapping fire-and-forget callers); the sub-agent scan runs on
// every call so newly-spawned agents are picked up.
async function ensureTranscriptWatcher(sessionFile) {
  const id = idFromPath(sessionFile);
  const rec = sessionIndex.get(id);
  if (!rec) return;
  // Skip transcript watching when the adapter doesn't expose token usage.
  // Marking the bucket lets consumers distinguish "unsupported" from "zero",
  // and avoids a wasted fs.watch handle per session.
  const adapter = getAdapter(rec.agentSource);
  if (!adapter.tokensSupported) {
    ensureTokens(rec);
    rec.tokens.unsupported = true;
    return;
  }
  const tr = ensureTranscriptSlice(rec);

  if (!tr.main && !tr._mainPending) {
    tr._mainPending = true;
    try {
      const tp = await getTranscriptPath(sessionFile);
      if (!tp) {
        console.error(`[tokens] ${id.slice(0,8)}: no transcript_path in hook events yet`);
        flagTranscriptMissing(rec, id);
        return;
      }
      // The transcript file is often not on disk yet when SessionStart is
      // processed — treat a miss as transient (the next event retries),
      // never as a permanent failure.
      try { await fsp.access(tp); }
      catch {
        console.error(`[tokens] ${id.slice(0,8)}: transcript not on disk yet at ${tp}`);
        flagTranscriptMissing(rec, id);
        return;
      }
      ensureTokens(rec);
      const tail = makeTail(tp);
      tr.main = tail;
      await readTailDelta(tail, rec);
      watchTail(tail, rec);
      // Discovery succeeded — clear any earlier "transcript missing" state and
      // push a snapshot so the UI swaps its placeholder for live tokens.
      rec.tokens.transcriptMissing = false;
      scheduleTokensBroadcast(id, rec);
      console.error(`[tokens] ${id.slice(0,8)}: main=${tokenSum(rec.tokens.main)} perAgent=${rec.tokens.perAgent.size}`);
    } finally {
      tr._mainPending = false;
    }
  }

  await ensureSubagentTails(tr, rec);
}

// Mark a session's token bucket as "transcript not located yet" and broadcast
// it, so the UI shows an explicit state instead of a blank pill. Transient:
// ensureTranscriptWatcher clears it as soon as discovery succeeds.
function flagTranscriptMissing(rec, id) {
  ensureTokens(rec);
  rec.tokens.transcriptMissing = true;
  scheduleTokensBroadcast(id, rec);
}

// Close every transcript watcher (main + sub-agents) and clear pending timers
// — called by deleteSession. Sets _closed so any debounced fs.watch callback
// that still fires within the 50ms window after deletion is a no-op instead of
// a stray SSE broadcast.
function closeTranscriptResources(rec) {
  if (!rec || !rec.transcript) return;
  const tr = rec.transcript;
  tr._closed = true;
  closeTail(tr.main);
  for (const tail of tr.subagents.values()) closeTail(tail);
}

function closeTail(tail) {
  if (!tail) return;
  if (tail.watcher) { try { tail.watcher.close(); } catch {} }
  if (tail._watchTimer) clearTimeout(tail._watchTimer);
}

module.exports = {
  getTranscriptPath,
  ensureFirstPrompt,
  ensureTranscriptWatcher,
  closeTranscriptResources,
  // Exposed for tests:
  _internals: {
    readFirstLine, extractPromptFromText, parseTranscriptEvent,
    ensureTranscriptSlice, makeTail, ensureSubagentTails, readTailDelta,
  },
};

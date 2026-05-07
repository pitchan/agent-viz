'use strict';
// Transcript reader — discovers transcript_path from a session's first event,
// scans for the first user prompt (cached), and tails the transcript for
// per-message token usage that feeds the tokens module.

const fs = require('fs');
const fsp = fs.promises;

const { sessionIndex, idFromPath } = require('./session-index');
const { ensureTokens, accumulateUsage, scheduleTokensBroadcast, tokenSum, newBucket } = require('./tokens');
const { broadcastSessionsChanged } = require('./sse');

// Read transcript path from the first event of a session file. We read up to
// 16 KB and parse the first complete line. Hook events stamp transcript_path
// at the top level, so it's always in the first JSONL record. If the first
// line doesn't fit in 16 KB or doesn't carry transcript_path, that's a real
// schema problem the caller needs to know about — return null + log instead
// of pretending to recover via regex against a truncated buffer.
async function getTranscriptPath(sessionFile) {
  let fh;
  try {
    fh = await fsp.open(sessionFile, 'r');
    const buf = Buffer.alloc(16384);
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    await fh.close();
    fh = null;
    const text = buf.slice(0, bytesRead).toString('utf8');
    const nl = text.indexOf('\n');
    if (nl === -1) {
      console.error(`[transcript] ${idFromPath(sessionFile).slice(0, 8)}: first line exceeds 16 KB — cannot extract transcript_path`);
      return null;
    }
    const firstLine = text.slice(0, nl);
    const evt = JSON.parse(firstLine);
    return evt.transcript_path || null;
  } catch (err) {
    if (fh) { try { await fh.close(); } catch {} }
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

// Parse one transcript line; return true if any token bucket was updated.
// Cheap pre-filter: lines without `"usage"` cannot match either branch below,
// and JSON.parse on a multi-KB line is the dominant cost when tailing a large
// transcript (system events, user messages, tool results all skip the parse).
function parseTranscriptEvent(line, rec) {
  if (!line || line.indexOf('"usage"') === -1) return false;
  let evt;
  try { evt = JSON.parse(line); } catch { return false; }
  let usage = null, key = null, model = null;
  // Main thread assistant message.
  if (evt.isSidechain === false && evt.type === 'assistant'
      && evt.message && evt.message.usage) {
    usage = evt.message.usage;
    model = evt.message.model || null;
    key = '__main__';
  }
  // Subagent streaming progress event. Structure observed in transcripts:
  //   evt.data = { type:"agent_progress", agentId, message:{ type:"assistant",
  //                message:{ ..., usage:{...} } } }
  else if (evt.type === 'progress' && evt.data
      && evt.data.type === 'agent_progress' && evt.data.agentId
      && evt.data.message && evt.data.message.message && evt.data.message.message.usage) {
    usage = evt.data.message.message.usage;
    model = evt.data.message.message.model || null;
    key = evt.data.agentId;
  }
  if (!usage) return false;
  ensureTokens(rec);
  let bucket;
  if (key === '__main__') {
    bucket = rec.tokens.main;
  } else {
    bucket = rec.tokens.perAgent.get(key);
    if (!bucket) {
      bucket = newBucket();
      rec.tokens.perAgent.set(key, bucket);
    }
  }
  accumulateUsage(bucket, usage, model);
  return true;
}

// Lazy initializer for the transcript slice on the session record. Groups all
// transcript-related state (path, read offset, partial line leftover, fs.watch
// handle, in-flight/pending guards) under a single namespace so transcript.js
// doesn't stamp eight fields directly onto the shared record object.
function ensureTranscriptSlice(rec) {
  if (!rec.transcript) {
    rec.transcript = {
      path: null, offset: 0, leftover: '',
      watcher: null,
      _readInFlight: false, _readPending: false,
      _watchTimer: null, _discoveryFailed: false, _closed: false,
    };
  }
  return rec.transcript;
}

// Append-only streaming read of the transcript. Preserves a line leftover for
// partial trailing writes. Same concurrency guard pattern as readAndBroadcast.
// `_closed` short-circuit guards against the race where deleteSession fires
// between the fs.watch debounce timer being scheduled (50ms) and it firing —
// without it we'd parse bytes into a `rec` already removed from sessionIndex
// and emit a stray SSE for a session the client just discarded.
async function readTranscriptDelta(transcriptPath, rec) {
  const tr = ensureTranscriptSlice(rec);
  if (tr._closed) return;
  if (tr._readInFlight) { tr._readPending = true; return; }
  tr._readInFlight = true;
  let fh;
  try {
    const stat = await fsp.stat(transcriptPath);
    const offset = tr.offset || 0;
    if (stat.size <= offset) return;
    const len = stat.size - offset;
    const buf = Buffer.alloc(len);
    fh = await fsp.open(transcriptPath, 'r');
    await fh.read(buf, 0, len, offset);
    await fh.close();
    fh = null;
    tr.offset = stat.size;
    const text = (tr.leftover || '') + buf.toString('utf8');
    const lines = text.split('\n');
    tr.leftover = lines.pop(); // possibly incomplete tail
    let changed = false;
    for (const line of lines) {
      if (!line) continue;
      if (parseTranscriptEvent(line, rec)) changed = true;
    }
    if (changed) scheduleTokensBroadcast(rec.id, rec);
  } catch {
    if (fh) { try { await fh.close(); } catch {} }
  } finally {
    tr._readInFlight = false;
    if (tr._readPending) {
      tr._readPending = false;
      setImmediate(() => readTranscriptDelta(transcriptPath, rec).catch(err => console.error(`[transcript] ${rec.id.slice(0, 8)}: re-read failed: ${err.message}`)));
    }
  }
}

// Discover transcript_path, do an initial full-file read to catch up, then
// open fs.watch for live updates. Idempotent — re-calls are no-op.
async function ensureTranscriptWatcher(sessionFile) {
  const id = idFromPath(sessionFile);
  const rec = sessionIndex.get(id);
  if (!rec) return;
  const tr = ensureTranscriptSlice(rec);
  if (tr.watcher || tr._discoveryFailed) return;
  const tp = await getTranscriptPath(sessionFile);
  if (!tp) { console.error(`[tokens] ${id.slice(0,8)}: no transcript_path in hook events yet`); return; }
  try { await fsp.access(tp); } catch { console.error(`[tokens] ${id.slice(0,8)}: transcript inaccessible at ${tp}`); tr._discoveryFailed = true; return; }
  tr.path = tp;
  tr.offset = 0;
  tr.leftover = '';
  ensureTokens(rec);
  await readTranscriptDelta(tp, rec);
  console.error(`[tokens] ${id.slice(0,8)}: main=${tokenSum(rec.tokens.main)} perAgent=${rec.tokens.perAgent.size}`);
  try {
    const watcher = fs.watch(tp, () => {
      if (tr._watchTimer) clearTimeout(tr._watchTimer);
      tr._watchTimer = setTimeout(() => {
        tr._watchTimer = null;
        readTranscriptDelta(tp, rec).catch(err => console.error(`[transcript] ${rec.id.slice(0, 8)}: watch read failed: ${err.message}`));
      }, 50);
    });
    tr.watcher = watcher;
  } catch {
    tr._discoveryFailed = true;
  }
}

// Close transcript watcher and clear pending timers — called by deleteSession.
// Sets _closed so any debounced fs.watch callback that still fires within the
// 50ms window after deletion is a no-op instead of a stray SSE broadcast.
function closeTranscriptResources(rec) {
  if (!rec || !rec.transcript) return;
  const tr = rec.transcript;
  tr._closed = true;
  if (tr.watcher) { try { tr.watcher.close(); } catch {} }
  if (tr._watchTimer) clearTimeout(tr._watchTimer);
}

module.exports = {
  getTranscriptPath,
  ensureFirstPrompt,
  ensureTranscriptWatcher,
  closeTranscriptResources,
  // Exposed for tests:
  _internals: { extractPromptFromText, parseTranscriptEvent, readTranscriptDelta },
};

'use strict';
// Transcript reader — discovers transcript_path from a session's first event,
// scans for the first user prompt (cached), and tails the transcript for
// per-message token usage that feeds the tokens module.

const fs = require('fs');
const fsp = fs.promises;

const { sessionIndex, idFromPath } = require('./session-index');
const { ensureTokens, accumulateUsage, scheduleTokensBroadcast, tokenSum } = require('./tokens');
const { broadcastSessionsChanged } = require('./sse');

// Read transcript path from the first event of a session file. The first line
// can be arbitrarily large (e.g. a PreToolUse Write with inline content), so
// we try a JSON.parse on the first line, and fall back to a regex scan of the
// first 16 KB — the transcript_path appears near the top of every event.
async function getTranscriptPath(sessionFile) {
  let fh;
  try {
    fh = await fsp.open(sessionFile, 'r');
    const buf = Buffer.alloc(16384);
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    await fh.close();
    fh = null;
    const text = buf.slice(0, bytesRead).toString('utf8');
    const firstLine = text.split('\n')[0];
    try {
      const evt = JSON.parse(firstLine);
      if (evt.transcript_path) return evt.transcript_path;
    } catch {}
    // Fallback: regex scan for "transcript_path":"..." (handles escaped \").
    const m = text.match(/"transcript_path":"((?:\\.|[^"\\])*)"/);
    if (m) { try { return JSON.parse('"' + m[1] + '"'); } catch { return m[1]; } }
    return null;
  } catch {
    if (fh) { try { await fh.close(); } catch {} }
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
function parseTranscriptEvent(line, rec) {
  let evt;
  try { evt = JSON.parse(line); } catch { return false; }
  let usage = null, key = null;
  // Main thread assistant message.
  if (evt.isSidechain === false && evt.type === 'assistant'
      && evt.message && evt.message.usage) {
    usage = evt.message.usage;
    key = '__main__';
  }
  // Subagent streaming progress event. Structure observed in transcripts:
  //   evt.data = { type:"agent_progress", agentId, message:{ type:"assistant",
  //                message:{ ..., usage:{...} } } }
  else if (evt.type === 'progress' && evt.data
      && evt.data.type === 'agent_progress' && evt.data.agentId
      && evt.data.message && evt.data.message.message && evt.data.message.message.usage) {
    usage = evt.data.message.message.usage;
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
      bucket = { in: 0, out: 0, cacheCreate: 0, cacheRead: 0 };
      rec.tokens.perAgent.set(key, bucket);
    }
  }
  accumulateUsage(bucket, usage);
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
      _watchTimer: null, _discoveryFailed: false,
    };
  }
  return rec.transcript;
}

// Append-only streaming read of the transcript. Preserves a line leftover for
// partial trailing writes. Same concurrency guard pattern as readAndBroadcast.
async function readTranscriptDelta(transcriptPath, rec) {
  const tr = ensureTranscriptSlice(rec);
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
      setImmediate(() => readTranscriptDelta(transcriptPath, rec).catch(() => {}));
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
        readTranscriptDelta(tp, rec).catch(() => {});
      }, 50);
    });
    tr.watcher = watcher;
  } catch {
    tr._discoveryFailed = true;
  }
}

// Close transcript watcher and clear pending timers — called by deleteSession.
function closeTranscriptResources(rec) {
  if (!rec || !rec.transcript) return;
  const tr = rec.transcript;
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

#!/usr/bin/env node
'use strict';
const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');

const PORT = process.env.PORT || 3333;
const HTML = path.join(__dirname, 'index.html');
const DIR = path.join(os.tmpdir(), 'claude-events');
try { fs.mkdirSync(DIR, { recursive: true }); } catch {}

const { execSync } = require('child_process');

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

// --- SSE clients ---
const sseClients = new Set();

function broadcastSSE(data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try { res.write(msg); } catch { sseClients.delete(res); }
  }
}

// Debounced "sessions list changed" broadcast. Collapses bursts of new-file /
// mtime-updated notifications into one client refresh.
let _sessionsChangedTimer = null;
function broadcastSessionsChanged() {
  if (_sessionsChangedTimer) return;
  _sessionsChangedTimer = setTimeout(() => {
    _sessionsChangedTimer = null;
    broadcastSSE({ type: 'sessionsChanged' });
  }, 2000);
}

// --- In-memory session index ---
// id -> { id, promptCache, promptWindow, eventCount, size, mtime }
// promptCache: undefined=never attempted, null=tried-nothing-found, string=found
// promptWindow: last window size we tried for prompt extraction
const sessionIndex = new Map();

function idFromPath(fp) { return path.basename(fp, '.jsonl'); }

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
    sessionIndex.set(id, {
      id,
      promptCache: undefined,
      promptWindow: 0,
      eventCount,
      size: stat.size,
      mtime: stat.mtimeMs,
    });
  } catch {}
}

function touchIndex(fp, sizeDelta, newlineDelta) {
  const id = idFromPath(fp);
  let rec = sessionIndex.get(id);
  if (!rec) {
    rec = { id, promptCache: undefined, promptWindow: 0, eventCount: 0, size: 0, mtime: Date.now() };
    sessionIndex.set(id, rec);
  }
  rec.size += sizeDelta;
  rec.eventCount += newlineDelta;
  rec.mtime = Date.now();
}

// --- File watchers + reader ---
const watchers = new Map();
const fileOffsets = new Map();
const debounceTimers = new Map();
const readInFlight = new Set();
const readPending = new Set();

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

// Read new bytes from a session file and broadcast via SSE.
// Async implementation — uses fs.promises to avoid blocking the event loop.
async function readAndBroadcast(filePath) {
  if (readInFlight.has(filePath)) { readPending.add(filePath); return; }
  readInFlight.add(filePath);
  let fh;
  try {
    const newStat = await fsp.stat(filePath);
    const offset = fileOffsets.get(filePath) || 0;
    if (newStat.size <= offset) return;
    const len = newStat.size - offset;
    const buf = Buffer.alloc(len);
    fh = await fsp.open(filePath, 'r');
    await fh.read(buf, 0, len, offset);
    await fh.close();
    fh = null;
    fileOffsets.set(filePath, newStat.size);
    const text = buf.toString('utf8');
    // Count newlines so we can update the in-memory index cheaply.
    let newlines = 0;
    for (let i = 0; i < buf.length; i++) if (buf[i] === 0x0a) newlines++;
    touchIndex(filePath, len, newlines);
    const sessionName = path.basename(filePath, '.jsonl');
    const lines = text.trim().split('\n');
    const rec = sessionIndex.get(sessionName);
    let tokensChanged = false;
    for (const line of lines) {
      try {
        const evt = JSON.parse(line);
        broadcastSSE({ type: 'event', session: sessionName, event: evt });
        // Reconciliation: PostToolUse on the Agent tool carries the subagent's
        // final usage. Use as fallback when the transcript stream has no data.
        if (rec && evt.hook_event_name === 'PostToolUse' && evt.tool_name === 'Agent'
            && evt.tool_response && evt.tool_response.agentId && evt.tool_response.usage) {
          ensureTokens(rec);
          const aid = evt.tool_response.agentId;
          const existing = rec.tokens.perAgent.get(aid);
          const isEmpty = !existing || (existing.in + existing.out + existing.cacheCreate + existing.cacheRead) === 0;
          if (isEmpty) {
            const u = evt.tool_response.usage;
            const bucket = newBucket();
            accumulateUsage(bucket, u);
            rec.tokens.perAgent.set(aid, bucket);
            tokensChanged = true;
          }
        }
      } catch {}
    }
    if (tokensChanged && rec) scheduleTokensBroadcast(sessionName, rec);
    // Warm the first-prompt cache if we haven't yet.
    if (rec && rec.promptCache === undefined) {
      // Fire-and-forget, small delay to let more text land on disk.
      setTimeout(() => { ensureFirstPrompt(filePath).catch(() => {}); }, 500);
    }
    // Discover transcript_path and start watching it for token usage.
    ensureTranscriptWatcher(filePath).catch(() => {});
  } catch {
    if (fh) { try { await fh.close(); } catch {} }
  } finally {
    readInFlight.delete(filePath);
    if (readPending.has(filePath)) {
      readPending.delete(filePath);
      // Re-run for the bytes that landed during this call.
      setImmediate(() => readAndBroadcast(filePath));
    }
  }
}

// ── Token tracking ──
// Each session accumulates token usage from its transcript (main thread +
// per-subagent). `PostToolUse(Agent)` hook events provide a fallback when the
// transcript has no data for that agent id yet. See design spec.

// Bucket shape:
//   { in, out, cacheCreate, cacheRead } — cumulative sums (for detailed popup).
//   { lastIn, lastCacheCreate, lastCacheRead } — most recent message's usage
//     values (not summed). The sum of these three = current context window size
//     (matches Claude Code's /context output).
function newBucket() {
  return { in:0, out:0, cacheCreate:0, cacheRead:0, lastIn:0, lastCacheCreate:0, lastCacheRead:0 };
}

function ensureTokens(rec) {
  if (!rec.tokens) {
    rec.tokens = {
      main: newBucket(),
      perAgent: new Map(),
    };
  }
}

function tokenSum(b) {
  if (!b) return 0;
  return (b.in || 0) + (b.out || 0) + (b.cacheCreate || 0) + (b.cacheRead || 0);
}

function accumulateUsage(bucket, usage) {
  bucket.in += usage.input_tokens || 0;
  bucket.out += usage.output_tokens || 0;
  bucket.cacheCreate += usage.cache_creation_input_tokens || 0;
  bucket.cacheRead += usage.cache_read_input_tokens || 0;
  // Track the most recent message's values. Transcript/hook events are parsed
  // in chronological order, so "last wins" gives the current context size.
  bucket.lastIn = usage.input_tokens || 0;
  bucket.lastCacheCreate = usage.cache_creation_input_tokens || 0;
  bucket.lastCacheRead = usage.cache_read_input_tokens || 0;
}

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

// Append-only streaming read of the transcript. Preserves a line leftover for
// partial trailing writes. Same concurrency guard pattern as readAndBroadcast.
async function readTranscriptDelta(transcriptPath, rec) {
  if (rec._transcriptReadInFlight) { rec._transcriptReadPending = true; return; }
  rec._transcriptReadInFlight = true;
  let fh;
  try {
    const stat = await fsp.stat(transcriptPath);
    const offset = rec.transcriptOffset || 0;
    if (stat.size <= offset) return;
    const len = stat.size - offset;
    const buf = Buffer.alloc(len);
    fh = await fsp.open(transcriptPath, 'r');
    await fh.read(buf, 0, len, offset);
    await fh.close();
    fh = null;
    rec.transcriptOffset = stat.size;
    const text = (rec.transcriptLeftover || '') + buf.toString('utf8');
    const lines = text.split('\n');
    rec.transcriptLeftover = lines.pop(); // possibly incomplete tail
    let changed = false;
    for (const line of lines) {
      if (!line) continue;
      if (parseTranscriptEvent(line, rec)) changed = true;
    }
    if (changed) scheduleTokensBroadcast(rec.id, rec);
  } catch {
    if (fh) { try { await fh.close(); } catch {} }
  } finally {
    rec._transcriptReadInFlight = false;
    if (rec._transcriptReadPending) {
      rec._transcriptReadPending = false;
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
  if (rec.transcriptWatcher || rec._transcriptDiscoveryFailed) return;
  const tp = await getTranscriptPath(sessionFile);
  if (!tp) { console.error(`[tokens] ${id.slice(0,8)}: no transcript_path in hook events yet`); return; }
  try { await fsp.access(tp); } catch { console.error(`[tokens] ${id.slice(0,8)}: transcript inaccessible at ${tp}`); rec._transcriptDiscoveryFailed = true; return; }
  rec.transcriptPath = tp;
  rec.transcriptOffset = 0;
  rec.transcriptLeftover = '';
  ensureTokens(rec);
  await readTranscriptDelta(tp, rec);
  console.error(`[tokens] ${id.slice(0,8)}: main=${tokenSum(rec.tokens.main)} perAgent=${rec.tokens.perAgent.size}`);
  try {
    const watcher = fs.watch(tp, () => {
      if (rec._transcriptWatchTimer) clearTimeout(rec._transcriptWatchTimer);
      rec._transcriptWatchTimer = setTimeout(() => {
        rec._transcriptWatchTimer = null;
        readTranscriptDelta(tp, rec).catch(() => {});
      }, 50);
    });
    rec.transcriptWatcher = watcher;
  } catch {
    rec._transcriptDiscoveryFailed = true;
  }
}

function scheduleTokensBroadcast(sid, rec) {
  if (rec._tokensBroadcastTimer) return;
  rec._tokensBroadcastTimer = setTimeout(() => {
    rec._tokensBroadcastTimer = null;
    broadcastTokens(sid, rec);
  }, 250);
}

function tokensSnapshot(rec) {
  if (!rec.tokens) return null;
  const perAgent = {};
  for (const [aid, bucket] of rec.tokens.perAgent) perAgent[aid] = bucket;
  return { main: rec.tokens.main, perAgent };
}

function broadcastTokens(sid, rec) {
  const snap = tokensSnapshot(rec);
  if (!snap) return;
  broadcastSSE({ type: 'tokens', session: sid, main: snap.main, perAgent: snap.perAgent });
}

function watchSession(filePath) {
  if (watchers.has(filePath)) return;
  try {
    const stat = fs.statSync(filePath);
    fileOffsets.set(filePath, stat.size);
  } catch { return; }

  const watcher = fs.watch(filePath, () => {
    // Debounce 50 ms — Windows fires multiple change events per write.
    if (debounceTimers.has(filePath)) clearTimeout(debounceTimers.get(filePath));
    debounceTimers.set(filePath, setTimeout(() => {
      debounceTimers.delete(filePath);
      readAndBroadcast(filePath);
    }, 50));
  });
  watchers.set(filePath, watcher);
}

// Close a per-file watcher and clean up its maps.
function unwatchSession(fp) {
  const w = watchers.get(fp);
  if (w) { w.close(); watchers.delete(fp); }
  fileOffsets.delete(fp);
  const t = debounceTimers.get(fp);
  if (t) { clearTimeout(t); debounceTimers.delete(fp); }
}

// Delete a session file + summary + clean everything related.
async function deleteSession(fp) {
  const id = idFromPath(fp);
  const rec = sessionIndex.get(id);
  if (rec) {
    if (rec.transcriptWatcher) { try { rec.transcriptWatcher.close(); } catch {} }
    if (rec._transcriptWatchTimer) clearTimeout(rec._transcriptWatchTimer);
    if (rec._tokensBroadcastTimer) clearTimeout(rec._tokensBroadcastTimer);
  }
  unwatchSession(fp);
  sessionIndex.delete(id);
  readInFlight.delete(fp);
  readPending.delete(fp);
  try { await fsp.unlink(fp); } catch {}
  // Also remove companion summary if it exists.
  try { await fsp.unlink(fp.replace('.jsonl', '.summary.json')); } catch {}
}

// ── Compaction ──
// For large files: read all events, keep the last COMPACT_KEEP_EVENTS, write a
// companion .summary.json with session metadata, then rewrite the JSONL.
async function compactSession(fp) {
  const id = idFromPath(fp);
  const rec = sessionIndex.get(id);
  if (!rec) return;
  let content;
  try { content = await fsp.readFile(fp, 'utf8'); } catch { return; }
  const allLines = content.trim().split('\n');
  if (allLines.length <= COMPACT_KEEP_EVENTS) return;

  // Build summary from the full history before we throw away old lines.
  const summary = { id, compactedAt: new Date().toISOString(), totalEvents: allLines.length, tools: [], prompt: rec.promptCache || null };
  for (const line of allLines) {
    try {
      const evt = JSON.parse(line);
      const e = evt.hook_event_name;
      if (e === 'PreToolUse' || e === 'PostToolUse' || e === 'PostToolUseFailure') {
        summary.tools.push({ name: evt.tool_name, id: evt.tool_use_id, event: e, ts: evt._ts });
      }
    } catch {}
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
    fileOffsets.set(fp, stat.size);
    console.log(`[housekeep] compacted ${id}: ${allLines.length} → ${kept.length} events, summary at ${path.basename(summaryPath)}`);
  } catch (err) {
    console.error(`[housekeep] compact failed for ${id}:`, err.message);
  }
}

// ── Purge + lazy-watch ──
async function housekeep() {
  const now = Date.now();
  let files;
  try { files = (await fsp.readdir(DIR)).filter(f => f.endsWith('.jsonl')); } catch { return; }

  // Stat all files and pair with index records.
  const entries = [];
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

  for (let i = 0; i < entries.length; i++) {
    const { fp, id, size, mtime } = entries[i];
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
      if (watchers.has(fp)) {
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
async function scanAndWatch() {
  try {
    const files = (await fsp.readdir(DIR)).filter(f => f.endsWith('.jsonl'));
    for (const f of files) {
      const fp = path.join(DIR, f);
      await indexSessionInitial(fp);
      // Only watch recent files — old ones are indexed but not watched.
      const rec = sessionIndex.get(idFromPath(fp));
      if (rec && (Date.now() - rec.mtime) < WATCH_WINDOW_MS) {
        watchSession(fp);
        // Kick off transcript discovery + token catch-up (fire-and-forget).
        ensureTranscriptWatcher(fp).catch(() => {});
      }
    }
  } catch {}
}

fs.watch(DIR, (_, filename) => {
  if (!filename || !filename.endsWith('.jsonl')) return;
  const fp = path.join(DIR, filename);
  if (fs.existsSync(fp)) {
    const isNew = !sessionIndex.has(idFromPath(fp));
    if (isNew) {
      // New file — seed the index synchronously with zeros, then stat async.
      sessionIndex.set(idFromPath(fp), {
        id: idFromPath(fp), promptCache: undefined, promptWindow: 0,
        eventCount: 0, size: 0, mtime: Date.now(),
      });
      broadcastSessionsChanged();
    }
    watchSession(fp);
  }
});

// --- Startup: kill old server ---
async function killOldServer() {
  const shutdownOk = await new Promise(resolve => {
    const req = http.request({ hostname: '127.0.0.1', port: PORT, path: '/shutdown', method: 'POST', timeout: 2000 }, res => {
      res.resume();
      res.on('end', () => resolve(true));
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end();
  });
  if (shutdownOk) { await new Promise(r => setTimeout(r, 500)); return; }
  try {
    const out = execSync(`netstat -ano | findstr ":${PORT}" | findstr "LISTEN"`, { encoding: 'utf8', timeout: 3000 });
    const match = out.match(/LISTENING\s+(\d+)/);
    if (match) {
      try { execSync(`taskkill /PID ${match[1]} /F`, { timeout: 3000 }); } catch {}
      await new Promise(r => setTimeout(r, 1000));
    }
  } catch {}
}

function latestSession() {
  let latest = null, latestMtime = 0;
  for (const rec of sessionIndex.values()) {
    if (rec.mtime > latestMtime) { latestMtime = rec.mtime; latest = rec.id; }
  }
  return latest ? path.join(DIR, latest + '.jsonl') : null;
}

let server;

function startServer() {
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');

    // CORS for SSE
    res.setHeader('Access-Control-Allow-Origin', '*');

    // Instant push from hook.js — bypasses fs.watch latency.
    if (url.pathname === '/notify' && req.method === 'POST') {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', async () => {
        try {
          const { session } = JSON.parse(body);
          if (session) {
            const fp = path.join(DIR, `${session}.jsonl`);
            try { await fsp.access(fp); } catch { res.writeHead(200); res.end('ok'); return; }
            if (!watchers.has(fp)) watchSession(fp);
            readAndBroadcast(fp);
          }
        } catch {}
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('ok');
      });
      return;
    }

    if (url.pathname === '/shutdown') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('bye');
      setTimeout(() => { server.close(); process.exit(0); }, 100);
      return;
    }

    // Serve static ES modules from /public. No directory traversal.
    if (req.method === 'GET' && url.pathname.startsWith('/public/')) {
      const safe = url.pathname.replace(/\.\.+/g, '');
      const p = path.join(__dirname, safe);
      const root = path.join(__dirname, 'public');
      if (p.startsWith(root + path.sep) || p === root) {
        try {
          const data = await fsp.readFile(p);
          res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
          res.end(data);
        } catch {
          res.writeHead(404);
          res.end('Not found');
        }
        return;
      }
    }

    if (url.pathname === '/' || url.pathname === '/index.html') {
      try {
        const html = await fsp.readFile(HTML);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
      } catch {
        res.writeHead(500);
        res.end('index.html missing');
      }
      return;
    }

    // SSE endpoint
    if (url.pathname === '/stream') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      res.write(':ok\n\n');
      sseClients.add(res);
      // Replay current token snapshots so a fresh client sees state immediately.
      for (const [sid, rec] of sessionIndex) {
        const snap = tokensSnapshot(rec);
        if (snap) {
          try {
            res.write(`data: ${JSON.stringify({ type: 'tokens', session: sid, main: snap.main, perAgent: snap.perAgent })}\n\n`);
          } catch {}
        }
      }
      req.on('close', () => sseClients.delete(res));
      return;
    }

    if (url.pathname === '/events') {
      if (url.searchParams.has('clear')) {
        const sid = url.searchParams.get('clear');
        try {
          if (sid && sid !== '1') {
            await deleteSession(path.join(DIR, sid + '.jsonl'));
          } else {
            const files = (await fsp.readdir(DIR)).filter(f => f.endsWith('.jsonl'));
            for (const f of files) await deleteSession(path.join(DIR, f));
          }
          broadcastSessionsChanged();
        } catch {}
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('cleared');
        return;
      }

      const offset = parseInt(url.searchParams.get('offset') || '0', 10);
      const sessionFile = url.searchParams.get('session')
        ? path.join(DIR, url.searchParams.get('session') + '.jsonl')
        : latestSession();

      let data = '', size = 0, sessionId = '';
      if (sessionFile) {
        sessionId = path.basename(sessionFile, '.jsonl');
        let fh;
        try {
          const stat = await fsp.stat(sessionFile);
          size = stat.size;
          if (offset < size) {
            const len = size - offset;
            const buf = Buffer.alloc(len);
            fh = await fsp.open(sessionFile, 'r');
            await fh.read(buf, 0, len, offset);
            await fh.close();
            fh = null;
            data = buf.toString('utf8');
          }
        } catch {
          if (fh) { try { await fh.close(); } catch {} }
        }
      }
      res.writeHead(200, {
        'Content-Type': 'application/x-ndjson',
        'Cache-Control': 'no-cache',
        'X-File-Size': String(size),
        'X-Session-Id': sessionId,
        'Access-Control-Expose-Headers': 'X-File-Size, X-Session-Id',
      });
      res.end(data);
      return;
    }

    // Summary for compacted sessions — serves the .summary.json if it exists.
    if (url.pathname === '/summary') {
      const sid = url.searchParams.get('session');
      if (!sid) { res.writeHead(400); res.end('missing session'); return; }
      const summaryPath = path.join(DIR, sid + '.summary.json');
      try {
        const data = await fsp.readFile(summaryPath, 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(data);
      } catch {
        res.writeHead(404);
        res.end('no summary');
      }
      return;
    }

    if (url.pathname === '/sessions') {
      // Optional forced rescan — rebuild index from disk. Useful if the user
      // deleted files outside the app or suspects drift.
      if (url.searchParams.has('rescan')) {
        sessionIndex.clear();
        await scanAndWatch();
      }
      // Warm any not-yet-attempted prompt caches in parallel (fire-and-forget
      // after the response so the client gets a fast reply).
      const missing = [];
      for (const rec of sessionIndex.values()) {
        if (rec.promptCache === undefined) missing.push(rec.id);
      }
      // Check which sessions have a .summary.json (compacted).
      const summarySet = new Set();
      try {
        const allFiles = await fsp.readdir(DIR);
        for (const f of allFiles) {
          if (f.endsWith('.summary.json')) summarySet.add(f.replace('.summary.json', ''));
        }
      } catch {}
      const sessions = [...sessionIndex.values()]
        .map(rec => ({
          id: rec.id,
          prompt: (typeof rec.promptCache === 'string') ? rec.promptCache : null,
          eventCount: rec.eventCount,
          size: rec.size,
          mtime: rec.mtime,
          compacted: summarySet.has(rec.id),
        }))
        .sort((a, b) => b.mtime - a.mtime);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(sessions));
      // Background: resolve missing prompts, then broadcast a single refresh.
      if (missing.length) {
        (async () => {
          for (const id of missing) {
            await ensureFirstPrompt(path.join(DIR, id + '.jsonl')).catch(() => {});
          }
        })();
      }
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  server.listen(PORT, () => {
    console.log(`agent-viz listening on http://localhost:${PORT}`);
  });
}

killOldServer().then(async () => {
  await scanAndWatch();
  // Purge old/empty sessions + compact large files on boot.
  await housekeep();
  // Re-run every hour.
  setInterval(() => housekeep().catch(() => {}), 3600_000);
  startServer();
});

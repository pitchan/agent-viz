'use strict';
// Append-only tail reader for per-session JSONL files + the fs.watch glue
// that drives it + session deletion.
//
// Owns: watchers, fileOffsets, debounceTimers, readInFlight, readPending.
// Calls into: session-index (touchIndex, sessionIndex), sse (broadcastSSE),
// tokens (clearTokensTimer), transcript
// (ensureTranscriptWatcher, ensureFirstPrompt, closeTranscriptResources).

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const {
  sessionIndex,
  idFromPath, touchIndex,
} = require('./session-index');
const { broadcastSSE } = require('./sse');
const { clearTokensTimer } = require('./tokens');
const {
  ensureFirstPrompt, ensureTranscriptWatcher, closeTranscriptResources,
} = require('./transcript');

const watchers = new Map();
const fileOffsets = new Map();
const debounceTimers = new Map();
const readInFlight = new Set();
const readPending = new Set();

// Read new bytes from a session file and broadcast via SSE.
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
    for (const line of lines) {
      try {
        const evt = JSON.parse(line);
        // Capture source agent on first event of a session.
        if (rec && !rec.agentSource && typeof evt._source === 'string') {
          rec.agentSource = evt._source;
        }
        broadcastSSE({ type: 'event', session: sessionName, event: evt });
      } catch {}
    }
    // Warm the first-prompt cache if we haven't yet.
    if (rec && rec.promptCache === undefined) {
      // Fire-and-forget, small delay to let more text land on disk.
      setTimeout(() => {
        ensureFirstPrompt(filePath).catch(err => console.error('[event-reader] ensureFirstPrompt:', err.message));
      }, 500);
    }
    // Discover transcript_path and start watching it for token usage.
    ensureTranscriptWatcher(filePath).catch(err => console.error('[event-reader] ensureTranscriptWatcher:', err.message));
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

function unwatchSession(fp) {
  const w = watchers.get(fp);
  if (w) { w.close(); watchers.delete(fp); }
  fileOffsets.delete(fp);
  const t = debounceTimers.get(fp);
  if (t) { clearTimeout(t); debounceTimers.delete(fp); }
}

function isWatched(fp) { return watchers.has(fp); }

// Reset the read offset for a file — used by housekeep.compactSession after
// rewriting a smaller version of the JSONL so we don't skip the new content.
function resetFileOffset(fp, size) {
  fileOffsets.set(fp, size);
}

// Delete a session file + summary + clean everything related.
async function deleteSession(fp) {
  const id = idFromPath(fp);
  const rec = sessionIndex.get(id);
  if (rec) {
    closeTranscriptResources(rec);
    clearTokensTimer(rec);
  }
  unwatchSession(fp);
  sessionIndex.delete(id);
  readInFlight.delete(fp);
  readPending.delete(fp);
  try { await fsp.unlink(fp); }
  catch (err) { if (err.code !== 'ENOENT') console.error(`[event-reader] unlink ${fp} failed: ${err.message}`); }
  // Also remove companion summary if it exists.
  try { await fsp.unlink(fp.replace('.jsonl', '.summary.json')); }
  catch (err) { if (err.code !== 'ENOENT') console.error(`[event-reader] unlink summary failed: ${err.message}`); }
}

module.exports = {
  readAndBroadcast,
  watchSession, unwatchSession, isWatched,
  resetFileOffset,
  deleteSession,
};

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
const { getWatchdogService } = require('./watchdog');

const watchers = new Map();
const fileOffsets = new Map();
const debounceTimers = new Map();
const readInFlight = new Set();
const readPending = new Set();

// Has the watchdog already failed once on this path? A pure detector that
// throws means a broken build, not a passing condition, so one line is enough
// to say it — and it must be said. The enclosing `catch {}` (there for
// JSON.parse) would otherwise swallow it forever: the watchdog would stop
// producing alerts for the whole life of the process and nothing would tell
// anyone. Detection failing is not a reason to stop serving the canvas, so we
// complain and carry on.
let watchdogFailed = false;

function feedWatchdog(wd, evt) {
  try {
    for (const alert of wd.onEvent(evt)) broadcastSSE({ type: 'alert', alert });
  } catch (err) {
    if (!watchdogFailed) {
      watchdogFailed = true;
      console.error('[watchdog] detection failed, failures are no longer being recorded:', err.message);
    }
  }
}

// The byte offset from which the live path owns this file.
//
// This is the hand-off point between the two readers of one file, and it is
// what keeps them from counting the same event twice. `watchSession` sets it
// when it arms the watcher; `readAndBroadcast` advances it as it feeds. So
// everything below it has already been handed to the watchdog by the live
// path, and everything above it will be — the start-up sweep reads [0, offset)
// and the watcher [offset, ∞). No overlap, no gap, and the boundary is a
// measured byte rather than a race won.
//
// Sharing by instant instead of by byte is what fails: the sweep reads whole
// files and yields to the event loop at every await, so anything written while
// it runs travels the live path AND is re-read from the file. The journal
// de-duplicates the resulting alert but not the detector's counters — loop
// stacks one occurrence per PreToolUse — so a command run twice would be
// reported as run four times.
//
// What makes the offset trustworthy is that `readAndBroadcast` advances it and
// feeds the lines with no await in between: no reader can ever observe an
// offset that has moved past events not yet fed.
//
// null means no live path covers this file — then the whole file is the
// sweep's business. `has` rather than a truthiness test on purpose: an offset
// of 0 is a real answer (a watcher armed on an empty file owns all of it), and
// `|| null` would turn it into "read everything" and bring the overlap back.
function liveHandoffOffset(fp) {
  return fileOffsets.has(fp) ? fileOffsets.get(fp) : null;
}

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
        // The watchdog sees the same stream as the canvas but draws something
        // else from it: what deserves to be recorded. `onEvent` returns only
        // facts it has never seen, so re-reading a file broadcasts nothing.
        // After the event goes out, never before: what the server announces is
        // already in the journal, and an alert never precedes the event that
        // produced it.
        const wd = getWatchdogService();
        if (wd) feedWatchdog(wd, evt);
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
  resetFileOffset, liveHandoffOffset,
  deleteSession,
};

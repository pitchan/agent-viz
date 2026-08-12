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
const { decodeJsonlLine } = require('./jsonl');
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
// to say it — and it must be said. The enclosing `catch {}` (there for the
// broadcast path since C2 took the decoding out of it — the shared primitive
// never throws) would otherwise swallow it forever: the watchdog would stop
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

// Where the live path FIRST fed the watchdog, per file. This is not the read
// cursor, and the difference is the whole point — see liveHandoffOffset.
const fedFrom = new Map();

// The byte offset from which the live path owns this file, as far as the
// watchdog is concerned.
//
// This is the hand-off point between the two readers of one file, and it is
// what keeps them from counting the same event twice: the start-up sweep reads
// [0, offset) and the live path [offset, ∞).
//
// The value is the offset of the FIRST live read that actually fed the
// detector, and nothing else will do. The read cursor will not: the live path
// reads and advances that cursor WITHOUT feeding for as long as the service
// does not exist yet — which is the whole of scanAndWatch() plus housekeep().
// Once the service does exist, every live delivery pushes the cursor past bytes
// the detector has already been given, so a sweep bounded by the cursor re-feeds
// them. Measured, not supposed: a session written to while the server boots
// yielded `Bash called 4x with the same input` on three real calls, with one
// timestamp listed twice — a durable line in an append-only journal.
//
// The arming offset will not do either, and is worse: it would drop
// [armed, service ready), which the live path reads and hands to nobody.
//
// Falling back to the cursor when nothing has been fed yet IS right: no live
// delivery has reached the detector, so everything below the cursor is still
// the sweep's to read. And that fallback carries weight in BOTH directions:
// setting a hand-off byte when nothing has been fed would not duplicate
// anything, it would dig a HOLE — the sweep would skip [0, offset), which
// nobody ever gave the detector, and the legitimate alert would simply never
// fire. Silence costs more than a duplicate, because silence does not show.
//
// Sharing by instant rather than by byte is what fails outright: the sweep
// reads whole files and yields to the event loop at every await, so anything
// written while it runs travels the live path AND is re-read from the file. The
// journal de-duplicates the resulting alert but not the detector's counters —
// loop stacks one occurrence per PreToolUse.
//
// null means no live path covers this file — then the whole file is the
// sweep's business. `has` rather than a truthiness test on purpose: an offset
// of 0 is a real answer (a watcher armed on an empty file owns all of it), and
// `|| null` would turn it into "read everything" and bring the overlap back.
function liveHandoffOffset(fp) {
  if (fedFrom.has(fp)) return fedFrom.get(fp);
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
    // Read once, before the loop: nothing awaits inside it, so the service
    // cannot appear or vanish half-way through. And the first read that has a
    // service to feed is the one that fixes this file's hand-off byte — from
    // `offset`, where THIS batch starts, not from where it ends.
    //
    // THE INVARIANT THAT KEEPS THIS FROM BEING A RACE, and it is the whole
    // reason the fix works: between `fileOffsets.set(...)` above and this
    // `fedFrom.set(...)` there is no rendezvous point — no await, no callback,
    // nothing that yields to the event loop. A concurrent sweep therefore sees
    // either the old cursor or the hand-off byte, and NEVER a cursor that has
    // moved on without its hand-off byte. That single state is the one where
    // the sweep would re-read bytes already fed. Keep them adjacent.
    const wd = getWatchdogService();
    if (wd && !fedFrom.has(filePath)) fedFrom.set(filePath, offset);
    for (const line of lines) {
      // C2 : le verdict sur une ligne vient de la primitive commune du moteur,
      // il n'est plus réimplémenté ici. C'est le chemin de CAPTURE VIVE, et
      // c'est là que la tolérance au BOM change le plus de choses : une ligne
      // préfixée d'un BOM était perdue en silence — ni diffusée au canevas, ni
      // donnée au chien de garde, donc invisible ET indétectable. Elle passe
      // désormais, comme partout ailleurs.
      const verdict = decodeJsonlLine(line);
      if (!verdict || !verdict.ok) continue;
      const evt = verdict.value;
      try {
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
  // No live path left on this file, so no hand-off byte either — the sweep is
  // on its own again. Keeping a stale one would fence off a stretch of file
  // that nobody reads any more.
  //
  // TRAP, for whoever makes a sweep run at any time other than boot: dropping
  // the byte lets a later sweep re-read what the live path already fed the
  // detector, and the double counting comes straight back — measured, three
  // distinct calls reported as four. Unreachable today only because runCatchUp
  // runs once at boot, before housekeep can unwatch anything. See the note on
  // runCatchUp where watchdog/index.js exports it.
  fedFrom.delete(fp);
  const t = debounceTimers.get(fp);
  if (t) { clearTimeout(t); debounceTimers.delete(fp); }
}

function isWatched(fp) { return watchers.has(fp); }

// Reset the read offset for a file — used by housekeep.compactSession after
// rewriting a smaller version of the JSONL so we don't skip the new content.
//
// The hand-off byte goes with it. The file has just been rewritten shorter, so
// the old byte points into a layout that no longer exists — keeping it would
// fence the sweep off from part of the NEW file. The cursor takes over as the
// boundary until the live path feeds again, which is exactly what it means.
function resetFileOffset(fp, size) {
  fileOffsets.set(fp, size);
  fedFrom.delete(fp);
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

# Copilot CLI multi-agent support — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make agent-viz capture, store, and display events from BOTH Claude Code and GitHub Copilot CLI in the same dashboard, with each event/session tagged by its source agent.

**Architecture:** Agent-specific hook installers write a tagged hook command (`--source=claude` / `--source=copilot`) into each agent's native config path (`.claude/settings.json` for Claude, `.github/hooks/agent-viz.json` + `~/.copilot/hooks/agent-viz.json` for Copilot). The shared `lib/hook.js` reads the source flag, stamps `_source` on each event, and writes to a renamed `${tmpdir}/agent-events/` directory. Server reads both old (`claude-events/`) and new dirs during a transition window and exposes `agentSource` in session metadata. Dashboard renders a colored pill badge on each session card and in the topbar.

**Tech Stack:** Node.js 18+ (no new deps), Server-Sent Events, vanilla ES modules + canvas frontend. No test framework added — verification is manual smoke testing with concrete commands and expected output.

**Reference spec:** [docs/superpowers/specs/2026-05-06-copilot-cli-support-design.md](../specs/2026-05-06-copilot-cli-support-design.md)

---

## File-touch plan

| File | Change | Reason |
|---|---|---|
| `lib/hook.js` | Modify | Parse `--source` flag, write to `agent-events/`, stamp `_source` |
| `lib/server.js` | Modify | Dual-dir read, expose `agentSource` in `/sessions` and SSE |
| `lib/install-hooks.js` | Modify (large) | Add Copilot install/uninstall/audit, agent detection, target dispatch |
| `bin/agent-viz.js` | Modify | New `--target` flag, multi-agent output formatting, updated help |
| `lib/preuninstall.js` | Modify | No code change needed if `uninstall()` handles both — verify |
| `index.html` | Modify | Add `.agent-badge` CSS + `<span id="topbar-agent">` element |
| `public/viz-network.js` | Modify | Render badges on session cards + sync topbar badge to active session |
| `package.json` | Modify | Bump version to `0.2.0`, update `description` |
| `README.md` | Modify | Document multi-agent support, new flags, new paths |

No new files.

---

## Task 1: Server reads both event directories

**Files:**
- Modify: `lib/server.js`

This task makes the server read JSONL files from both `${tmpdir}/agent-events/` (new primary) and `${tmpdir}/claude-events/` (legacy). All downstream functions (watcher, housekeep, deleteSession, /events, /summary, /notify) need to find sessions by ID across both dirs. We track each session's home dir on its index record.

- [ ] **Step 1: Replace single `DIR` constant with two-dir model**

In `lib/server.js`, replace the line:
```js
const DIR = path.join(os.tmpdir(), 'claude-events');
try { fs.mkdirSync(DIR, { recursive: true }); } catch {}
```
with:
```js
// Primary dir for new events. Hooks write here. We watch this dir for new files.
const DIR = path.join(os.tmpdir(), 'agent-events');
// Legacy dir from agent-viz < 0.2.0 (Claude-only). Read at startup so old
// sessions remain browsable, but we don't watch it (sessions there are closed).
// Drop after 2 minor versions (target: v0.4.0).
const LEGACY_DIR = path.join(os.tmpdir(), 'claude-events');
try { fs.mkdirSync(DIR, { recursive: true }); } catch {}
```

- [ ] **Step 2: Helper to resolve a session's file path across both dirs**

Add right after the `LEGACY_DIR` constants (before the SSE section):
```js
// Map sid → directory the session file lives in. Populated by indexSessionInitial.
// Used so /notify, /events, /summary, deleteSession can find a session that
// originated in either dir.
const sessionDirs = new Map();

function sessionFilePath(sid) {
  const dir = sessionDirs.get(sid) || DIR;
  return path.join(dir, sid + '.jsonl');
}
```

- [ ] **Step 3: Make `indexSessionInitial` aware of source dir**

Replace the current `indexSessionInitial(fp)` body with:
```js
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
    sessionDirs.set(id, path.dirname(fp));
  } catch {}
}
```

- [ ] **Step 4: Update `touchIndex` to record dir for newly-discovered sessions**

Replace the current `touchIndex(fp, sizeDelta, newlineDelta)` body with:
```js
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
  if (!sessionDirs.has(id)) sessionDirs.set(id, path.dirname(fp));
}
```

- [ ] **Step 5: Make `scanAndWatch` walk both dirs**

Replace the current `scanAndWatch()` body with:
```js
async function scanAndWatch() {
  for (const dir of [DIR, LEGACY_DIR]) {
    let files;
    try { files = (await fsp.readdir(dir)).filter(f => f.endsWith('.jsonl')); }
    catch { continue; }
    for (const f of files) {
      const fp = path.join(dir, f);
      await indexSessionInitial(fp);
      const rec = sessionIndex.get(idFromPath(fp));
      // Only watch recent files in the primary dir. Legacy dir is read-only:
      // those sessions are closed by definition (older agent-viz no longer
      // running).
      if (dir === DIR && rec && (Date.now() - rec.mtime) < WATCH_WINDOW_MS) {
        watchSession(fp);
        ensureTranscriptWatcher(fp).catch(() => {});
      }
    }
  }
}
```

- [ ] **Step 6: Make `housekeep` walk both dirs**

Replace the section starting `let files;` through `entries.push(...)` in `housekeep()`:
```js
  // Stat all files across both dirs.
  const entries = [];
  for (const dir of [DIR, LEGACY_DIR]) {
    let files;
    try { files = (await fsp.readdir(dir)).filter(f => f.endsWith('.jsonl')); }
    catch { continue; }
    for (const f of files) {
      const fp = path.join(dir, f);
      const id = idFromPath(fp);
      let stat;
      try { stat = await fsp.stat(fp); } catch { continue; }
      entries.push({ fp, id, size: stat.size, mtime: stat.mtimeMs });
    }
  }
```

- [ ] **Step 7: Update `latestSession()` to use `sessionFilePath`**

Replace the current `latestSession()` body with:
```js
function latestSession() {
  let latest = null, latestMtime = 0;
  for (const rec of sessionIndex.values()) {
    if (rec.mtime > latestMtime) { latestMtime = rec.mtime; latest = rec.id; }
  }
  return latest ? sessionFilePath(latest) : null;
}
```

- [ ] **Step 8: Update `deleteSession` cleanup to clear `sessionDirs`**

In `deleteSession(fp)`, after the existing `sessionIndex.delete(id);` line, add:
```js
  sessionDirs.delete(id);
```

- [ ] **Step 9: Update `fs.watch(DIR, ...)` to seed `sessionDirs` for new files**

Replace the existing `fs.watch(DIR, (_, filename) => { ... })` block with:
```js
fs.watch(DIR, (_, filename) => {
  if (!filename || !filename.endsWith('.jsonl')) return;
  const fp = path.join(DIR, filename);
  if (fs.existsSync(fp)) {
    const id = idFromPath(fp);
    const isNew = !sessionIndex.has(id);
    if (isNew) {
      sessionIndex.set(id, {
        id, promptCache: undefined, promptWindow: 0,
        eventCount: 0, size: 0, mtime: Date.now(),
      });
      sessionDirs.set(id, DIR);
      broadcastSessionsChanged();
    }
    watchSession(fp);
  }
});
```

- [ ] **Step 10: Update `/notify` and `/events` endpoints to use `sessionFilePath`**

In the `/notify` POST handler, replace the line:
```js
            const fp = path.join(DIR, `${session}.jsonl`);
```
with:
```js
            const fp = sessionFilePath(session);
```

In `/events` GET handler, replace the line:
```js
      const sessionFile = sessionParam
        ? path.join(DIR, sessionParam + '.jsonl')
        : latestSession();
```
with:
```js
      const sessionFile = sessionParam
        ? sessionFilePath(sessionParam)
        : latestSession();
```

In `/events?clear=` POST handler (the `else` branch that clears all sessions), replace the inner block with:
```js
          } else {
            for (const dir of [DIR, LEGACY_DIR]) {
              let files;
              try { files = (await fsp.readdir(dir)).filter(f => f.endsWith('.jsonl')); }
              catch { continue; }
              for (const f of files) await deleteSession(path.join(dir, f));
            }
          }
```

And replace the single-session-clear branch:
```js
            await deleteSession(path.join(DIR, sid + '.jsonl'));
```
with:
```js
            await deleteSession(sessionFilePath(sid));
```

- [ ] **Step 11: Update `/summary` endpoint to look in the right dir**

In the `/summary` handler, replace:
```js
      const summaryPath = path.join(DIR, sid + '.summary.json');
```
with:
```js
      const dir = sessionDirs.get(sid) || DIR;
      const summaryPath = path.join(dir, sid + '.summary.json');
```

- [ ] **Step 12: Smoke test — server reads both dirs**

Set up legacy + new dirs and verify the server picks both up.

```bash
# Make sure agent-viz is stopped first
node F:/DEV/agent-viz/bin/agent-viz.js stop 2>/dev/null

# Seed a fake legacy session
TMPDIR=$(node -e "console.log(require('os').tmpdir())")
mkdir -p "$TMPDIR/claude-events" "$TMPDIR/agent-events"
echo '{"hook_event_name":"SessionStart","session_id":"legacy-test-001","_ts":"2026-05-06T00:00:00.000Z"}' > "$TMPDIR/claude-events/legacy-test-001.jsonl"
echo '{"hook_event_name":"SessionStart","session_id":"new-test-002","_ts":"2026-05-06T00:00:00.000Z","_source":"copilot"}' > "$TMPDIR/agent-events/new-test-002.jsonl"

# Start server in foreground (background-detach with &)
node F:/DEV/agent-viz/bin/agent-viz.js start --foreground --no-install-hooks --port 3334 &
SERVER_PID=$!
sleep 2

# Hit /sessions and verify both sessions appear
curl -s http://localhost:3334/sessions | node -e "
  let buf=''; process.stdin.on('data',d=>buf+=d); process.stdin.on('end',()=>{
    const arr=JSON.parse(buf);
    const ids=arr.map(s=>s.id);
    if(!ids.includes('legacy-test-001')) { console.error('FAIL: legacy session missing'); process.exit(1); }
    if(!ids.includes('new-test-002'))    { console.error('FAIL: new session missing'); process.exit(1); }
    console.log('PASS: both sessions visible:', ids.join(', '));
  });
"

kill $SERVER_PID 2>/dev/null
rm -f "$TMPDIR/claude-events/legacy-test-001.jsonl" "$TMPDIR/agent-events/new-test-002.jsonl"
```
Expected output: `PASS: both sessions visible: new-test-002, legacy-test-001` (order varies by mtime).

- [ ] **Step 13: Commit**

```bash
git -C F:/DEV/agent-viz add lib/server.js
git -C F:/DEV/agent-viz commit -m "$(cat <<'EOF'
server: read both agent-events/ and legacy claude-events/ dirs

Track each session's source dir on its index record so /notify, /events,
/summary, and deleteSession resolve the right path. Watcher only attaches
to the primary dir — legacy sessions are closed by definition.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Hook accepts `--source` flag, writes to `agent-events/`, stamps `_source`

**Files:**
- Modify: `lib/hook.js`

- [ ] **Step 1: Parse `--source` from argv and switch dir name**

Replace the entire content of `lib/hook.js` with:
```js
#!/usr/bin/env node
'use strict';
// Multi-agent hook: read JSON event from stdin, append to a per-session JSONL
// file in os.tmpdir()/agent-events/, and fire-and-forget POST /notify to the
// running agent-viz server (default 127.0.0.1:3333).
//
// Source agent (claude | copilot) is taken from --source=<agent> on argv.
// Defaults to 'claude' for back-compat with old hook commands installed by
// agent-viz < 0.2.0 that didn't carry the flag.

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');

const DIR = path.join(os.tmpdir(), 'agent-events');
const PORT = parseInt(process.env.AGENT_VIZ_PORT || process.env.PORT || '3333', 10);

function parseSource(argv) {
  for (const a of argv) {
    if (a.startsWith('--source=')) {
      const v = a.slice('--source='.length);
      if (v === 'claude' || v === 'copilot') return v;
    }
  }
  return 'claude';
}

function runHook() {
  try { fs.mkdirSync(DIR, { recursive: true }); } catch {}

  const source = parseSource(process.argv.slice(2));

  // Safety net: if stdin never closes, exit after 5 s so we never wedge a hook.
  const safety = setTimeout(() => process.exit(0), 5000);

  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', c => { input += c; });
  process.stdin.on('end', () => {
    clearTimeout(safety);
    try {
      const evt = JSON.parse(input);
      evt._ts = new Date().toISOString();
      evt._source = source;
      const sid = evt.session_id || 'unknown';
      const file = path.join(DIR, `${sid}.jsonl`);
      fs.appendFileSync(file, JSON.stringify(evt) + '\n');

      const body = JSON.stringify({ session: sid });
      const req = http.request({
        hostname: '127.0.0.1', port: PORT, path: '/notify',
        method: 'POST', timeout: 200,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      }, () => {});
      req.on('error', () => {});
      req.on('timeout', () => req.destroy());
      req.end(body);
    } catch {}
    process.exit(0);
  });
}

module.exports = { runHook, parseSource };

if (require.main === module) runHook();
```

- [ ] **Step 2: Smoke test — hook writes to new dir with `_source` stamp**

```bash
TMPDIR=$(node -e "console.log(require('os').tmpdir())")
rm -rf "$TMPDIR/agent-events"

# Simulate Copilot calling the hook
echo '{"hook_event_name":"SessionStart","session_id":"smoke-001"}' | \
  node F:/DEV/agent-viz/bin/agent-viz.js hook --source=copilot

# Verify file created in agent-events/, with _source stamped
node -e "
  const fs=require('fs'),path=require('path'),os=require('os');
  const fp=path.join(os.tmpdir(),'agent-events','smoke-001.jsonl');
  const evt=JSON.parse(fs.readFileSync(fp,'utf8').trim());
  if(evt._source!=='copilot'){console.error('FAIL: _source =',evt._source);process.exit(1);}
  console.log('PASS: _source stamped =',evt._source);
"
rm "$TMPDIR/agent-events/smoke-001.jsonl"
```
Expected: `PASS: _source stamped = copilot`.

- [ ] **Step 3: Smoke test — hook defaults to `claude` when flag absent**

```bash
echo '{"hook_event_name":"SessionStart","session_id":"smoke-002"}' | \
  node F:/DEV/agent-viz/bin/agent-viz.js hook

node -e "
  const fs=require('fs'),path=require('path'),os=require('os');
  const fp=path.join(os.tmpdir(),'agent-events','smoke-002.jsonl');
  const evt=JSON.parse(fs.readFileSync(fp,'utf8').trim());
  if(evt._source!=='claude'){console.error('FAIL: _source =',evt._source);process.exit(1);}
  console.log('PASS: default _source =',evt._source);
"
TMPDIR=$(node -e "console.log(require('os').tmpdir())")
rm "$TMPDIR/agent-events/smoke-002.jsonl"
```
Expected: `PASS: default _source = claude`.

- [ ] **Step 4: Commit**

```bash
git -C F:/DEV/agent-viz add lib/hook.js
git -C F:/DEV/agent-viz commit -m "$(cat <<'EOF'
hook: accept --source flag, write to agent-events/, stamp _source

Hook command now self-identifies its agent via --source=claude|copilot.
Output dir renamed from claude-events/ to agent-events/ to reflect
multi-agent storage. Defaults to 'claude' when flag absent (back-compat
with hooks installed by < 0.2.0).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Server exposes `agentSource` in /sessions and SSE events

**Files:**
- Modify: `lib/server.js`

The session index needs to remember each session's source agent (derived from the first event's `_source` field, defaulting to `claude` for legacy events without it). Then `/sessions` and the SSE stream surface it.

- [ ] **Step 1: Capture `_source` when reading events**

In `readAndBroadcast(filePath)`, find the line `const evt = JSON.parse(line);`. Right after that line, **before** the `broadcastSSE(...)` call, add:
```js
        // Capture source agent on first event of a session.
        if (rec && !rec.agentSource && typeof evt._source === 'string') {
          rec.agentSource = evt._source;
        }
```

- [ ] **Step 2: Backfill `agentSource` from disk during `indexSessionInitial`**

This handles the case where a session file already exists at startup (legacy or carried over) — we want its `agentSource` populated before the first SSE delta hits.

Replace the body of `indexSessionInitial(fp)` with:
```js
async function indexSessionInitial(fp) {
  const id = idFromPath(fp);
  if (sessionIndex.has(id)) return;
  try {
    const stat = await fsp.stat(fp);
    const eventCount = await countNewlinesStreaming(fp);
    // Read the first event's _source if present (cheap: only the first 4 KB).
    let agentSource;
    try {
      const fh = await fsp.open(fp, 'r');
      const buf = Buffer.alloc(Math.min(4096, stat.size));
      await fh.read(buf, 0, buf.length, 0);
      await fh.close();
      const firstLine = buf.toString('utf8').split('\n')[0];
      if (firstLine) {
        try {
          const evt = JSON.parse(firstLine);
          if (typeof evt._source === 'string') agentSource = evt._source;
        } catch {}
      }
    } catch {}
    // Default to claude if the field is missing — covers both legacy claude-events/
    // files (Claude-only era) and any malformed first-line that fails to parse.
    if (!agentSource) agentSource = 'claude';
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
```

- [ ] **Step 3: Seed `agentSource` for newly-watched files**

In the `fs.watch(DIR, ...)` block, replace the existing newly-created session record:
```js
      sessionIndex.set(id, {
        id, promptCache: undefined, promptWindow: 0,
        eventCount: 0, size: 0, mtime: Date.now(),
      });
```
with:
```js
      sessionIndex.set(id, {
        id, promptCache: undefined, promptWindow: 0,
        eventCount: 0, size: 0, mtime: Date.now(),
        agentSource: undefined, // populated when first event arrives
      });
```
And in `touchIndex`, replace:
```js
    rec = { id, promptCache: undefined, promptWindow: 0, eventCount: 0, size: 0, mtime: Date.now() };
```
with:
```js
    rec = { id, promptCache: undefined, promptWindow: 0, eventCount: 0, size: 0, mtime: Date.now(), agentSource: undefined };
```

- [ ] **Step 4: Expose `agentSource` in `/sessions` payload**

In the `/sessions` GET handler, replace the `.map(rec => ({...}))` block with:
```js
      const sessions = [...sessionIndex.values()]
        .map(rec => ({
          id: rec.id,
          prompt: (typeof rec.promptCache === 'string') ? rec.promptCache : null,
          eventCount: rec.eventCount,
          size: rec.size,
          mtime: rec.mtime,
          compacted: summarySet.has(rec.id),
          agentSource: rec.agentSource || 'claude',
        }))
        .sort((a, b) => b.mtime - a.mtime);
```

- [ ] **Step 5: Smoke test — `/sessions` returns `agentSource`**

```bash
TMPDIR=$(node -e "console.log(require('os').tmpdir())")
mkdir -p "$TMPDIR/agent-events"
echo '{"hook_event_name":"SessionStart","session_id":"agent-src-001","_source":"copilot"}' > "$TMPDIR/agent-events/agent-src-001.jsonl"
echo '{"hook_event_name":"SessionStart","session_id":"agent-src-002","_source":"claude"}' > "$TMPDIR/agent-events/agent-src-002.jsonl"

node F:/DEV/agent-viz/bin/agent-viz.js stop 2>/dev/null
node F:/DEV/agent-viz/bin/agent-viz.js start --foreground --no-install-hooks --port 3334 &
SERVER_PID=$!
sleep 2

curl -s http://localhost:3334/sessions | node -e "
  let buf=''; process.stdin.on('data',d=>buf+=d); process.stdin.on('end',()=>{
    const arr=JSON.parse(buf);
    const a=arr.find(s=>s.id==='agent-src-001');
    const b=arr.find(s=>s.id==='agent-src-002');
    if(!a||a.agentSource!=='copilot'){console.error('FAIL: 001 agentSource =',a&&a.agentSource);process.exit(1);}
    if(!b||b.agentSource!=='claude'){console.error('FAIL: 002 agentSource =',b&&b.agentSource);process.exit(1);}
    console.log('PASS: agentSource exposed correctly');
  });
"

kill $SERVER_PID 2>/dev/null
rm "$TMPDIR/agent-events/agent-src-001.jsonl" "$TMPDIR/agent-events/agent-src-002.jsonl"
```
Expected: `PASS: agentSource exposed correctly`.

- [ ] **Step 6: Commit**

```bash
git -C F:/DEV/agent-viz add lib/server.js
git -C F:/DEV/agent-viz commit -m "$(cat <<'EOF'
server: expose agentSource in /sessions and SSE stream

Each session's source agent is captured from the first event's _source
field (or backfilled from disk for sessions present at startup), defaulting
to 'claude' for legacy events without the field. Surfaced on the /sessions
JSON payload so the dashboard can render per-source badges.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: install-hooks emits `--source=claude` in Claude commands

**Files:**
- Modify: `lib/install-hooks.js`

This is a one-line change to `resolveHookCommand`, plus making sure existing hook entries (without the `--source` flag) are auto-detected as stale and refreshed.

- [ ] **Step 1: Append `--source=claude` to the resolved command**

In `lib/install-hooks.js`, replace the `resolveHookCommand` function body. Find:
```js
  if (!isEphemeral && fs.existsSync(binPath)) {
    const norm = binPath.replace(/\\/g, '/');
    return { command: `node "${norm}" hook`, mode: 'absolute', path: norm };
  }
  let v = version;
  if (!v) {
    try { v = require(path.join(packageRoot, 'package.json')).version; } catch {}
  }
  const spec = v ? `agent-viz@${v}` : 'agent-viz';
  return { command: `npx --yes ${spec} hook`, mode: 'npx', spec };
```
and replace it with:
```js
  if (!isEphemeral && fs.existsSync(binPath)) {
    const norm = binPath.replace(/\\/g, '/');
    return { command: `node "${norm}" hook --source=claude`, mode: 'absolute', path: norm };
  }
  let v = version;
  if (!v) {
    try { v = require(path.join(packageRoot, 'package.json')).version; } catch {}
  }
  const spec = v ? `agent-viz@${v}` : 'agent-viz';
  return { command: `npx --yes ${spec} hook --source=claude`, mode: 'npx', spec };
```

- [ ] **Step 2: Verify staleness detection still works**

The existing `isStandardShape` regex (`/^node\s+["']/` or `/^npx\s/`) still matches the new commands. The existing `isAgentVizHook` regex (`/agent-viz(?:@[\w.\-]+)?(?:\.js)?["']?\s+hook\b/`) also matches because `\b` after `hook` allows the trailing space + `--source=claude`. Confirm with a quick sanity script:

```bash
node -e "
  const m = require('F:/DEV/agent-viz/lib/install-hooks.js');
  // Old-style command (no --source flag) — should match isAgentVizHook
  const oldHook = { type: 'command', command: 'node \"/path/agent-viz/bin/agent-viz.js\" hook' };
  // New-style command (with --source) — should also match
  const newHook = { type: 'command', command: 'node \"/path/agent-viz/bin/agent-viz.js\" hook --source=claude' };
  if (!m.isAgentVizHook(oldHook)) { console.error('FAIL: old hook not detected'); process.exit(1); }
  if (!m.isAgentVizHook(newHook)) { console.error('FAIL: new hook not detected'); process.exit(1); }
  if (!m.isStandardShape(oldHook.command)) { console.error('FAIL: old command not standard shape'); process.exit(1); }
  if (!m.isStandardShape(newHook.command)) { console.error('FAIL: new command not standard shape'); process.exit(1); }
  console.log('PASS: both old and new shapes detected as agent-viz + standard');
"
```
Expected: `PASS: both old and new shapes detected as agent-viz + standard`.

- [ ] **Step 3: Smoke test — fresh Claude install includes flag**

```bash
TMPDIR=$(node -e "console.log(require('os').tmpdir())")
TEST_HOME="$TMPDIR/agentviz-test-home"
rm -rf "$TEST_HOME"
mkdir -p "$TEST_HOME"

# Run install with HOME redirected (Linux/Git Bash); on Windows use USERPROFILE.
HOME="$TEST_HOME" USERPROFILE="$TEST_HOME" node F:/DEV/agent-viz/lib/install-hooks.js --user

# Read the resulting settings file and check the command shape
node -e "
  const fs=require('fs'),path=require('path');
  const fp=path.join(process.env.TEST_HOME,'.claude','settings.json');
  const s=JSON.parse(fs.readFileSync(fp,'utf8'));
  const cmd=s.hooks.SessionStart[0].hooks[0].command;
  if(!cmd.includes('--source=claude')){console.error('FAIL: command missing flag:',cmd);process.exit(1);}
  console.log('PASS: command =',cmd);
" TEST_HOME="$TEST_HOME"

rm -rf "$TEST_HOME"
```
Expected: `PASS: command = node ".../bin/agent-viz.js" hook --source=claude` (or the npx variant if dev clone is detected as ephemeral).

- [ ] **Step 4: Commit**

```bash
git -C F:/DEV/agent-viz add lib/install-hooks.js
git -C F:/DEV/agent-viz commit -m "$(cat <<'EOF'
install-hooks: emit --source=claude flag on Claude hook commands

Pre-0.2.0 hooks without the flag are auto-refreshed by the existing
staleness detection (the desired command differs, so install rewrites
in place). Standard-shape detection regex unchanged.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: install-hooks adds Copilot side (resolve, install, uninstall, audit)

**Files:**
- Modify: `lib/install-hooks.js`

This task adds the parallel Copilot path: scope resolution, command builder, file content shape, install/uninstall/audit. The existing Claude functions are renamed for clarity (or aliased) — we keep public API stable for the next task to wire up.

- [ ] **Step 1: Add Copilot constants and scope resolver**

Right after the existing `EVENTS` constant (line 20) in `lib/install-hooks.js`, add:
```js
// Copilot CLI uses the same five overlapping events. Names are PascalCase
// so Copilot emits the VS Code-compatible payload (snake_case fields like
// session_id, hook_event_name) — same shape Claude already produces.
const EVENTS_COPILOT = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop'];

// Filename for the dedicated agent-viz hooks file inside Copilot config dirs.
const COPILOT_FILE = 'agent-viz.json';
const COPILOT_LOCAL_FILE = 'agent-viz.local.json';
```

- [ ] **Step 2: Add `resolveCopilotScope`**

Right after the existing `resolveScope` function (around line 181), add:
```js
// Resolve where to write Copilot hooks.
//   resolveCopilotScope({ scope: 'user'|'project'|'local'|undefined, cwd })
//     → { scope, file, projectRoot }
// Defaults mirror Claude's: project detected → 'local' (.github/hooks/agent-viz.local.json),
// no project → 'user' (~/.copilot/hooks/agent-viz.json).
function resolveCopilotScope({ scope, cwd } = {}) {
  cwd = cwd || process.cwd();
  if (scope === 'user') {
    return {
      scope: 'user',
      file: path.join(os.homedir(), '.copilot', 'hooks', COPILOT_FILE),
      projectRoot: null,
    };
  }
  const projectRoot = findProjectRoot(cwd);
  if (scope === 'project') {
    if (!projectRoot) throw new Error('--project requested but no .git/ or package.json found from cwd');
    return {
      scope: 'project',
      file: path.join(projectRoot, '.github', 'hooks', COPILOT_FILE),
      projectRoot,
    };
  }
  if (scope === 'local') {
    if (!projectRoot) throw new Error('--local requested but no .git/ or package.json found from cwd');
    return {
      scope: 'local',
      file: path.join(projectRoot, '.github', 'hooks', COPILOT_LOCAL_FILE),
      projectRoot,
    };
  }
  if (projectRoot) {
    return {
      scope: 'local',
      file: path.join(projectRoot, '.github', 'hooks', COPILOT_LOCAL_FILE),
      projectRoot,
    };
  }
  return {
    scope: 'user',
    file: path.join(os.homedir(), '.copilot', 'hooks', COPILOT_FILE),
    projectRoot: null,
  };
}
```

- [ ] **Step 3: Add `resolveCopilotHookCommand`**

Right after `resolveHookCommand`, add:
```js
// Same logic as resolveHookCommand but tags the command with --source=copilot.
function resolveCopilotHookCommand({ packageRoot, version } = {}) {
  packageRoot = packageRoot || path.resolve(__dirname, '..');
  const binPath = path.join(packageRoot, 'bin', 'agent-viz.js');
  const isEphemeral = packageRoot.includes(`${path.sep}_npx${path.sep}`)
                   || packageRoot.includes('/_npx/');
  if (!isEphemeral && fs.existsSync(binPath)) {
    const norm = binPath.replace(/\\/g, '/');
    return { command: `node "${norm}" hook --source=copilot`, mode: 'absolute', path: norm };
  }
  let v = version;
  if (!v) {
    try { v = require(path.join(packageRoot, 'package.json')).version; } catch {}
  }
  const spec = v ? `agent-viz@${v}` : 'agent-viz';
  return { command: `npx --yes ${spec} hook --source=copilot`, mode: 'npx', spec };
}
```

- [ ] **Step 4: Add Copilot file builder, audit, install, uninstall**

Right before the `// ── High-level API ──` comment (around line 231), add:
```js
// ── Copilot helpers ──

// Build the JSON content for a Copilot hooks.json file. The same node command
// goes in both `bash` and `powershell` keys — node is cross-platform and
// resolves the script path identically on Windows and Unix. timeoutSec mirrors
// Claude's `timeout: 5` (seconds).
function buildCopilotHookFile(command) {
  const entry = (cmd) => ({
    type: 'command',
    bash: cmd,
    powershell: cmd,
    timeoutSec: 5,
  });
  const hooks = {};
  for (const ev of EVENTS_COPILOT) hooks[ev] = [entry(command)];
  return { version: 1, hooks };
}

function readCopilotFile(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) {
    if (e.code === 'ENOENT') return null;
    throw new Error(`${file} invalid : ${e.message}`);
  }
}

// True if the file is a recognizable agent-viz Copilot hooks file: shape
// matches { version, hooks: { <event>: [{ type:'command', bash|powershell }] } }
// AND the command mentions agent-viz hook.
function isAgentVizCopilotFile(content) {
  if (!content || typeof content !== 'object') return false;
  if (content.version !== 1 || !content.hooks) return false;
  for (const ev of EVENTS_COPILOT) {
    const arr = content.hooks[ev];
    if (!Array.isArray(arr)) continue;
    for (const e of arr) {
      const cmd = e && (e.bash || e.powershell);
      if (typeof cmd === 'string' && /agent-viz/.test(cmd) && /\bhook\b/.test(cmd)) return true;
    }
  }
  return false;
}

function auditCopilot({ scope, cwd, packageRoot, version } = {}) {
  const target = resolveCopilotScope({ scope, cwd });
  const cmd = resolveCopilotHookCommand({ packageRoot, version });
  const content = readCopilotFile(target.file);
  const rows = EVENTS_COPILOT.map(ev => {
    const entries = (content && content.hooks && content.hooks[ev]) || [];
    let installed = false, stale = false, others = 0;
    for (const e of entries) {
      const c = e && (e.bash || e.powershell);
      if (typeof c === 'string' && /agent-viz/.test(c) && /\bhook\b/.test(c)) {
        installed = true;
        if (c !== cmd.command) stale = true;
      } else {
        others++;
      }
    }
    return { event: ev, installed, stale, others };
  });
  return { ...target, audit: rows, command: cmd };
}

function installCopilot({ scope, cwd, packageRoot, version } = {}) {
  const target = resolveCopilotScope({ scope, cwd });
  const cmd = resolveCopilotHookCommand({ packageRoot, version });
  const desired = buildCopilotHookFile(cmd.command);
  const existing = readCopilotFile(target.file);

  let action = 'noop';
  let missing = [];
  let updated = [];
  let present = [];
  let coexisting = {};

  if (!existing) {
    action = 'installed';
    missing = [...EVENTS_COPILOT];
  } else if (!isAgentVizCopilotFile(existing)) {
    // Existing file isn't ours (someone else's hook config under our filename
    // — vanishingly unlikely but possible). Refuse to overwrite, surface to caller.
    throw new Error(`refusing to overwrite ${target.file}: not an agent-viz hooks file`);
  } else {
    // Compare event-by-event.
    for (const ev of EVENTS_COPILOT) {
      const arr = (existing.hooks && existing.hooks[ev]) || [];
      const ours = arr.find(e => {
        const c = e && (e.bash || e.powershell);
        return typeof c === 'string' && /agent-viz/.test(c) && /\bhook\b/.test(c);
      });
      const others = arr.filter(e => e !== ours).length;
      if (others > 0) coexisting[ev] = others;
      if (!ours) missing.push(ev);
      else if ((ours.bash || ours.powershell) !== cmd.command) updated.push(ev);
      else present.push(ev);
    }
    if (missing.length === 0 && updated.length === 0) {
      return { target, action: 'noop', missing, updated, present, coexisting, command: cmd };
    }
    action = (missing.length && updated.length) ? 'installed+updated'
           : missing.length ? 'installed' : 'updated';
  }

  fs.mkdirSync(path.dirname(target.file), { recursive: true });
  fs.writeFileSync(target.file, JSON.stringify(desired, null, 2) + '\n');

  let gitignore = null;
  if (target.scope === 'local' && target.projectRoot) {
    gitignore = ensureCopilotGitignore(target.projectRoot);
  }

  return { target, action, missing, updated, present, coexisting, command: cmd, gitignore };
}

function uninstallCopilot({ scope, cwd } = {}) {
  // Mirror Claude uninstall: if scope is unspecified, sweep all three; else just one.
  const targets = [];
  if (scope) {
    targets.push(resolveCopilotScope({ scope, cwd }));
  } else {
    targets.push({
      scope: 'user',
      file: path.join(os.homedir(), '.copilot', 'hooks', COPILOT_FILE),
      projectRoot: null,
    });
    const projectRoot = findProjectRoot(cwd || process.cwd());
    if (projectRoot) {
      targets.push({
        scope: 'project',
        file: path.join(projectRoot, '.github', 'hooks', COPILOT_FILE),
        projectRoot,
      });
      targets.push({
        scope: 'local',
        file: path.join(projectRoot, '.github', 'hooks', COPILOT_LOCAL_FILE),
        projectRoot,
      });
    }
  }
  const results = [];
  for (const t of targets) {
    if (!fs.existsSync(t.file)) {
      results.push({ ...t, removed: 0, exists: false });
      continue;
    }
    const content = readCopilotFile(t.file);
    if (isAgentVizCopilotFile(content)) {
      // Atomic delete — file is dedicated to agent-viz.
      try { fs.unlinkSync(t.file); } catch {}
      results.push({ ...t, removed: EVENTS_COPILOT.length, exists: true });
    } else {
      // Not ours — leave it alone.
      results.push({ ...t, removed: 0, exists: true });
    }
  }
  return { results };
}

// .gitignore handling for project-local Copilot hook file.
function ensureCopilotGitignore(projectRoot) {
  const gi = path.join(projectRoot, '.gitignore');
  if (!fs.existsSync(gi)) return { changed: false, reason: 'no .gitignore (skipped)' };
  const content = fs.readFileSync(gi, 'utf8');
  const lines = content.split('\n').map(l => l.trim());
  const target = '.github/hooks/agent-viz.local.json';
  const alreadyIgnored = lines.some(l =>
    l === target ||
    l === '.github/hooks/' ||
    l === '.github/hooks/*.local.json' ||
    l === '.github/hooks/agent-viz.local.json'
  );
  if (alreadyIgnored) return { changed: false, reason: 'already ignored' };
  const sep = content.endsWith('\n') ? '' : '\n';
  fs.appendFileSync(gi, `${sep}${target}\n`);
  return { changed: true };
}
```

- [ ] **Step 5: Export new symbols**

In the `module.exports = { ... }` block at the bottom of `lib/install-hooks.js`, add (alongside the existing exports):
```js
  EVENTS_COPILOT,
  resolveCopilotScope,
  resolveCopilotHookCommand,
  installCopilot,
  uninstallCopilot,
  auditCopilot,
```

- [ ] **Step 6: Smoke test — Copilot user install creates a clean dedicated file**

```bash
TMPDIR=$(node -e "console.log(require('os').tmpdir())")
TEST_HOME="$TMPDIR/agentviz-test-copilot-home"
rm -rf "$TEST_HOME"

node -e "
  process.env.HOME='$TEST_HOME';
  process.env.USERPROFILE='$TEST_HOME';
  const m=require('F:/DEV/agent-viz/lib/install-hooks.js');
  const r=m.installCopilot({ scope:'user', packageRoot: 'F:/DEV/agent-viz' });
  console.log('action:',r.action);
  console.log('file:',r.target.file);
  const fs=require('fs');
  const content=JSON.parse(fs.readFileSync(r.target.file,'utf8'));
  if(content.version!==1){console.error('FAIL: version');process.exit(1);}
  for(const ev of ['SessionStart','UserPromptSubmit','PreToolUse','PostToolUse','Stop']){
    const arr=content.hooks[ev]||[];
    if(!arr[0]||!arr[0].bash||!arr[0].bash.includes('--source=copilot')){
      console.error('FAIL: missing or wrong command on',ev);process.exit(1);
    }
  }
  console.log('PASS: file is well-formed and tagged with --source=copilot');
"

# Cleanup: uninstall and verify deletion
node -e "
  process.env.HOME='$TEST_HOME';
  process.env.USERPROFILE='$TEST_HOME';
  const m=require('F:/DEV/agent-viz/lib/install-hooks.js');
  const r=m.uninstallCopilot({ scope:'user' });
  for(const x of r.results){
    console.log('uninstall:',x.scope,'removed=',x.removed,'exists=',x.exists);
  }
  const fs=require('fs');
  for(const x of r.results){
    if(fs.existsSync(x.file)){console.error('FAIL: file still exists:',x.file);process.exit(1);}
  }
  console.log('PASS: file removed cleanly');
"

rm -rf "$TEST_HOME"
```
Expected: `PASS: file is well-formed and tagged with --source=copilot` then `PASS: file removed cleanly`.

- [ ] **Step 7: Commit**

```bash
git -C F:/DEV/agent-viz add lib/install-hooks.js
git -C F:/DEV/agent-viz commit -m "$(cat <<'EOF'
install-hooks: add Copilot CLI install/uninstall/audit functions

Copilot hooks live in a dedicated file (~/.copilot/hooks/agent-viz.json
or .github/hooks/agent-viz[.local].json), shaped per Copilot's official
hooks.json format ({ version: 1, hooks: { <Event>: [...] } }) with both
bash and powershell command keys for cross-OS support.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Agent detection + unified install/uninstall/audit dispatcher

**Files:**
- Modify: `lib/install-hooks.js`

Add `detectAgents` and wrap the existing `install`/`uninstall`/`audit` functions to dispatch by `target` ('claude' | 'copilot' | 'both').

- [ ] **Step 1: Add `detectAgents`**

Right after the `findProjectRoot` function (around line 153) in `lib/install-hooks.js`, add:
```js
// Detect which CLI agents are present on the system. Used to default `target`
// when the caller didn't specify. We accept either: binary on PATH, OR the
// agent's config home dir exists with at least one file.
function detectAgents({ cwd } = {}) {
  const home = os.homedir();
  function dirHasFiles(p) {
    try { return fs.readdirSync(p).length > 0; } catch { return false; }
  }
  function inPath(name) {
    const PATH = process.env.PATH || '';
    const sep = process.platform === 'win32' ? ';' : ':';
    const exts = process.platform === 'win32' ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';') : [''];
    for (const dir of PATH.split(sep)) {
      if (!dir) continue;
      for (const ext of exts) {
        try { if (fs.existsSync(path.join(dir, name + ext))) return true; } catch {}
      }
    }
    return false;
  }
  return {
    claude: inPath('claude') || fs.existsSync(path.join(home, '.claude', 'settings.json')),
    copilot: inPath('copilot') || dirHasFiles(path.join(home, '.copilot')),
  };
}
```

- [ ] **Step 2: Rename existing `install`/`uninstall`/`audit` to Claude-specific names**

The existing `install`, `uninstall`, `audit` functions become Claude-specific. Rename them in place:

Find `function audit({ scope, cwd, packageRoot, version } = {}) {` → rename to `function auditClaude(...)`.
Find `function install({ scope, cwd, packageRoot, version } = {}) {` → rename to `function installClaude(...)`.
Find `function uninstall({ scope, cwd } = {}) {` → rename to `function uninstallClaude(...)`.

In their bodies, no internal references to themselves — safe rename.

- [ ] **Step 3: Add unified dispatchers**

Right after `uninstallClaude`, add:
```js
// ── Multi-agent dispatchers (public API) ──
//
// `target` is one of: 'claude' | 'copilot' | 'both' | undefined.
// undefined → auto-detect (install for whichever is present; if neither, claude).
//
// Returns { claude?, copilot? } where each side carries the same shape the
// per-agent function returned. Callers iterate the keys to format output.

function resolveTargets({ target, cwd }) {
  if (target === 'claude') return { claude: true, copilot: false };
  if (target === 'copilot') return { claude: false, copilot: true };
  if (target === 'both') return { claude: true, copilot: true };
  // auto-detect
  const detected = detectAgents({ cwd });
  if (!detected.claude && !detected.copilot) return { claude: true, copilot: false };
  return detected;
}

function install({ target, scope, cwd, packageRoot, version } = {}) {
  const t = resolveTargets({ target, cwd });
  const out = {};
  if (t.claude) out.claude = installClaude({ scope, cwd, packageRoot, version });
  if (t.copilot) {
    try { out.copilot = installCopilot({ scope, cwd, packageRoot, version }); }
    catch (e) { out.copilot = { error: e.message }; }
  }
  return out;
}

function uninstall({ target, scope, cwd } = {}) {
  // Uninstall always sweeps both unless explicitly targeted, regardless of
  // detection — we don't want a clean uninstall to leave Copilot hooks behind
  // just because Copilot got removed from PATH after install.
  const t = target ? resolveTargets({ target, cwd }) : { claude: true, copilot: true };
  const out = {};
  if (t.claude) out.claude = uninstallClaude({ scope, cwd });
  if (t.copilot) out.copilot = uninstallCopilot({ scope, cwd });
  return out;
}

function audit({ target, scope, cwd, packageRoot, version } = {}) {
  const t = resolveTargets({ target, cwd });
  const out = {};
  if (t.claude) out.claude = auditClaude({ scope, cwd, packageRoot, version });
  if (t.copilot) out.copilot = auditCopilot({ scope, cwd, packageRoot, version });
  return out;
}
```

- [ ] **Step 4: Update `module.exports`**

Replace the existing `module.exports = { ... }` block with:
```js
module.exports = {
  EVENTS,
  EVENTS_COPILOT,
  isAgentVizHook,
  isStandardShape,
  detectAgents,
  // Multi-agent dispatchers (preferred public API)
  install,
  uninstall,
  audit,
  // Per-agent escape hatches
  installClaude,
  uninstallClaude,
  auditClaude,
  installCopilot,
  uninstallCopilot,
  auditCopilot,
  // Helpers
  resolveScope,
  resolveCopilotScope,
  resolveHookCommand,
  resolveCopilotHookCommand,
  findProjectRoot,
  ensureGitignore,
  ensureCopilotGitignore,
  // exposed for tests / advanced use:
  _internals: {
    readSettings, writeSettings, auditSettings, addHook, removeHook,
    hasHookForEvent, inspectEvent, refreshStaleCommand,
    buildCopilotHookFile, readCopilotFile, isAgentVizCopilotFile,
  },
};
```

- [ ] **Step 5: Update standalone CLI in `lib/install-hooks.js` to use new dispatchers**

The bottom of `lib/install-hooks.js` has a `cliMain` function (around line 347). Replace the `install` mode block (last block in cliMain, after the `if (mode === 'uninstall')` block) with:
```js
  // install
  const result = install({ scope, cwd });
  if (result.claude) {
    const r = result.claude;
    console.log(`[claude] settings : ${r.target.file}  (scope: ${r.target.scope})`);
    console.log(`[claude] hook cmd : ${r.command.command}  (mode: ${r.command.mode})`);
    if (r.action === 'noop') console.log('[claude] ✓ déjà installé et à jour.');
    else {
      if (r.missing.length > 0) console.log(`[claude] ✓ Ajouté sur : ${r.missing.join(', ')}`);
      if (r.updated.length > 0) console.log(`[claude] ✓ Rafraîchi sur : ${r.updated.join(', ')}`);
    }
  }
  if (result.copilot) {
    const r = result.copilot;
    if (r.error) {
      console.log(`[copilot] ! ${r.error}`);
    } else {
      console.log(`[copilot] file : ${r.target.file}  (scope: ${r.target.scope})`);
      console.log(`[copilot] hook cmd : ${r.command.command}  (mode: ${r.command.mode})`);
      if (r.action === 'noop') console.log('[copilot] ✓ déjà installé et à jour.');
      else console.log(`[copilot] ✓ ${r.action}`);
    }
  }
```

Replace the `if (mode === 'check')` block similarly:
```js
  if (mode === 'check') {
    const result = audit({ scope, cwd });
    let allGood = true;
    for (const [agent, a] of Object.entries(result)) {
      console.log(`[${agent}] settings : ${a.file}  (scope: ${a.scope})`);
      for (const { event, installed, stale, others } of a.audit) {
        const flag = installed ? (stale ? '~' : 'x') : ' ';
        const tags = [];
        if (stale) tags.push('stale');
        if (others > 0) tags.push(`+${others} other`);
        console.log(`[${agent}]   [${flag}] ${event}${tags.length ? '   (' + tags.join(', ') + ')' : ''}`);
        if (!installed || stale) allGood = false;
      }
    }
    process.exit(allGood ? 0 : 1);
  }
```

Replace the `if (mode === 'uninstall')` block:
```js
  if (mode === 'uninstall') {
    const result = uninstall({ scope, cwd });
    let total = 0;
    for (const [agent, x] of Object.entries(result)) {
      const results = x.results || [];
      for (const r of results) {
        total += r.removed;
        if (r.removed > 0) console.log(`[${agent}] ✓ retiré ${r.removed} de ${r.file} (${r.scope})`);
        else if (r.exists) console.log(`[${agent}]   rien à retirer dans ${r.file} (${r.scope})`);
      }
    }
    if (total === 0) console.log('Aucun hook agent-viz trouvé.');
    return;
  }
```

- [ ] **Step 6: Smoke test — auto-detect + unified install**

```bash
TMPDIR=$(node -e "console.log(require('os').tmpdir())")
TEST_HOME="$TMPDIR/agentviz-test-unified"
rm -rf "$TEST_HOME"
mkdir -p "$TEST_HOME/.claude" "$TEST_HOME/.copilot"
echo '{}' > "$TEST_HOME/.claude/settings.json"
echo '{}' > "$TEST_HOME/.copilot/config.json"

# Auto-detect should find both agents (since both dirs exist with files)
node -e "
  process.env.HOME='$TEST_HOME';
  process.env.USERPROFILE='$TEST_HOME';
  const m=require('F:/DEV/agent-viz/lib/install-hooks.js');
  const d=m.detectAgents({});
  console.log('detected:',JSON.stringify(d));
  if(!d.claude||!d.copilot){console.error('FAIL: detection');process.exit(1);}
  const r=m.install({ scope:'user', packageRoot:'F:/DEV/agent-viz' });
  if(!r.claude||!r.copilot){console.error('FAIL: missing target in result');process.exit(1);}
  if(r.claude.action==='noop')console.log('[claude] noop (was already installed?)');
  if(r.copilot.action==='noop')console.log('[copilot] noop (was already installed?)');
  console.log('claude file:',r.claude.target.file);
  console.log('copilot file:',r.copilot.target.file);
  console.log('PASS: both targets installed');
"
rm -rf "$TEST_HOME"
```
Expected: `PASS: both targets installed`.

- [ ] **Step 7: Commit**

```bash
git -C F:/DEV/agent-viz add lib/install-hooks.js
git -C F:/DEV/agent-viz commit -m "$(cat <<'EOF'
install-hooks: add detectAgents + unified install/uninstall/audit dispatchers

install({target, ...}) now returns { claude?, copilot? } and dispatches to
each agent's installer. Auto-detection (claude in PATH || ~/.claude/
settings.json; copilot in PATH || ~/.copilot/ has files) drives the default
when no target is specified. Per-agent functions (installClaude, etc.)
remain accessible for advanced callers.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: CLI surface — `--target` flag + multi-agent output

**Files:**
- Modify: `bin/agent-viz.js`

Add `--target` flag handling, update the help text, reformat install/uninstall/check output for the multi-agent case, and update the auto-installer in `cmdStart` to print per-agent results.

- [ ] **Step 1: Update help text**

Replace the body of `help()` (lines 21-41) with:
```js
function help() {
  console.log(`agent-viz v${PKG_VERSION}

Usage:
  agent-viz [start]              Start the visualizer (default).
                                   --port N           listen on port N (default 3333)
                                   --foreground       attach to terminal (don't daemonize)
                                   --no-install-hooks don't auto-install hooks
                                   --open             open browser to the URL
  agent-viz stop                 Stop the running visualizer.
  agent-viz status               Show running state + URL.
  agent-viz install-hooks        Install hooks. Default: auto-detect (Claude + Copilot if present).
                                   --target=claude|copilot|both   force a target
                                   --user             user-level config (~/.claude or ~/.copilot)
                                   --project          repo-committed config
                                   --local            repo-local gitignored config (default in project)
                                   --check            audit instead of installing (exit 1 on stale/missing)
  agent-viz uninstall-hooks      Remove hooks (sweeps all targets unless --target given).
  agent-viz hook                 Internal — read JSON event from stdin.
                                   --source=claude|copilot   set the source agent tag
  agent-viz --help               Show this help.
  agent-viz --version            Print version.
`);
}
```

- [ ] **Step 2: Add `--target` parsing helper**

Right after `pickScopeFlag` (around line 76), add:
```js
function pickTargetFlag(flags) {
  const v = flags.target;
  if (v === 'claude' || v === 'copilot' || v === 'both') return v;
  return undefined;
}
```

- [ ] **Step 3: Rewrite `cmdInstallHooks` for multi-agent**

Replace the entire `cmdInstallHooks(argv)` function (lines 169-210) with:
```js
function cmdInstallHooks(argv) {
  const flags = parseFlags(argv, {
    booleans: ['user', 'project', 'local', 'check'],
    values: ['target'],
  });
  const scope = pickScopeFlag(flags);
  const target = pickTargetFlag(flags);
  const { install, audit } = require(path.join(PKG_ROOT, 'lib', 'install-hooks.js'));

  if (flags.check) {
    const result = audit({ target, scope, cwd: process.cwd(), packageRoot: PKG_ROOT, version: PKG_VERSION });
    let exitCode = 0;
    for (const [agent, a] of Object.entries(result)) {
      console.log(`${agent === 'claude' ? 'Claude Code' : 'Copilot CLI'}:`);
      console.log(`  settings : ${a.file}  (scope: ${a.scope})`);
      for (const { event, installed, stale, others } of a.audit) {
        const flag = installed ? (stale ? '~' : 'x') : ' ';
        const tags = [];
        if (stale) tags.push('stale');
        if (others > 0) tags.push(`+${others} other`);
        console.log(`  [${flag}] ${event}${tags.length ? '   (' + tags.join(', ') + ')' : ''}`);
        if (!installed || stale) exitCode = 1;
      }
    }
    process.exit(exitCode);
  }

  const result = install({ target, scope, cwd: process.cwd(), packageRoot: PKG_ROOT, version: PKG_VERSION });
  for (const [agent, r] of Object.entries(result)) {
    const label = agent === 'claude' ? 'Claude Code' : 'Copilot CLI';
    if (r.error) {
      console.log(`${label}: ! ${r.error}`);
      continue;
    }
    console.log(`${label}:`);
    console.log(`  settings : ${r.target.file}  (scope: ${r.target.scope})`);
    console.log(`  hook cmd : ${r.command.command}  (mode: ${r.command.mode})`);
    if (r.action === 'noop') {
      console.log('  ✓ already installed and up to date.');
    } else {
      if (r.missing && r.missing.length > 0) console.log(`  ✓ added: ${r.missing.join(', ')}`);
      if (r.updated && r.updated.length > 0) console.log(`  ✓ refreshed (was stale): ${r.updated.join(', ')}`);
      if (r.present && r.present.length > 0) console.log(`  (already up to date: ${r.present.join(', ')})`);
    }
    const others = Object.entries(r.coexisting || {});
    if (others.length > 0) {
      console.log('  Coexisting hooks (run in parallel, untouched):');
      for (const [ev, n] of others) console.log(`    - ${ev}: ${n} other(s)`);
    }
    if (r.gitignore && r.gitignore.changed) {
      console.log(`  + .gitignore : added ${agent === 'claude' ? '.claude/settings.local.json' : '.github/hooks/agent-viz.local.json'}`);
    }
  }
  // Final hint if anything actually changed.
  const anyChange = Object.values(result).some(r => r && r.action && r.action !== 'noop');
  if (anyChange) {
    console.log('\n→ Reopen /hooks in your agent (or restart it) to reload settings.');
  }
}
```

- [ ] **Step 4: Rewrite `cmdUninstallHooks` for multi-agent**

Replace `cmdUninstallHooks(argv)`:
```js
function cmdUninstallHooks(argv) {
  const flags = parseFlags(argv, {
    booleans: ['user', 'project', 'local'],
    values: ['target'],
  });
  const scope = pickScopeFlag(flags);
  const target = pickTargetFlag(flags);
  const { uninstall } = require(path.join(PKG_ROOT, 'lib', 'install-hooks.js'));
  const result = uninstall({ target, scope, cwd: process.cwd() });
  let total = 0;
  for (const [agent, x] of Object.entries(result)) {
    const results = x.results || [];
    const label = agent === 'claude' ? 'Claude Code' : 'Copilot CLI';
    for (const r of results) {
      total += r.removed;
      if (r.removed > 0) console.log(`${label}: ✓ removed ${r.removed} from ${r.file} (${r.scope})`);
      else if (r.exists) console.log(`${label}:   nothing to remove in ${r.file} (${r.scope})`);
      else console.log(`${label}:   ${r.file} does not exist (${r.scope})`);
    }
  }
  if (total === 0) console.log('No agent-viz hooks found.');
}
```

- [ ] **Step 5: Update `cmdStart` auto-installer to print multi-agent output**

Replace the block in `cmdStart` from `if (shouldInstall) {` through its closing `}` (lines 97-123) with:
```js
  if (shouldInstall) {
    const { install } = require(path.join(PKG_ROOT, 'lib', 'install-hooks.js'));
    try {
      const result = install({ cwd: process.cwd(), packageRoot: PKG_ROOT, version: PKG_VERSION });
      let printed = false;
      for (const [agent, r] of Object.entries(result)) {
        if (!r || r.error || r.action === 'noop') continue;
        const label = agent === 'claude' ? 'Claude Code' : 'Copilot CLI';
        const verb = r.action === 'updated' ? 'refreshed'
                   : r.action === 'installed+updated' ? 'installed + refreshed'
                   : 'installed';
        console.log(`✓ ${label} hooks ${verb} → ${r.target.file}`);
        console.log(`  scope: ${r.target.scope}, mode: ${r.command.mode}`);
        if (r.missing && r.missing.length > 0) console.log(`  added on: ${r.missing.join(', ')}`);
        if (r.updated && r.updated.length > 0) console.log(`  refreshed on (was stale): ${r.updated.join(', ')}`);
        if (r.gitignore && r.gitignore.changed) {
          console.log(`  + .gitignore : added ${agent === 'claude' ? '.claude/settings.local.json' : '.github/hooks/agent-viz.local.json'}`);
        }
        printed = true;
      }
      if (printed) console.log('  → reopen /hooks in your agent (or restart) to reload settings.');
    } catch (e) {
      console.error(`! hook install skipped: ${e.message}`);
    }
  }
```

- [ ] **Step 6: Smoke test — `--target=copilot --check` reports Copilot only**

```bash
TMPDIR=$(node -e "console.log(require('os').tmpdir())")
TEST_HOME="$TMPDIR/agentviz-test-cli-target"
rm -rf "$TEST_HOME"
mkdir -p "$TEST_HOME"

HOME="$TEST_HOME" USERPROFILE="$TEST_HOME" node F:/DEV/agent-viz/bin/agent-viz.js install-hooks --target=copilot --user
# Expect: prints "Copilot CLI:" but no "Claude Code:" line

HOME="$TEST_HOME" USERPROFILE="$TEST_HOME" node F:/DEV/agent-viz/bin/agent-viz.js install-hooks --target=copilot --user --check
# Expect: exit 0, "[x]" on all five events under "Copilot CLI:"
echo "exit code: $?"

HOME="$TEST_HOME" USERPROFILE="$TEST_HOME" node F:/DEV/agent-viz/bin/agent-viz.js uninstall-hooks --target=copilot --user
# Expect: file removed

rm -rf "$TEST_HOME"
```
Expected: each command's output described above.

- [ ] **Step 7: Commit**

```bash
git -C F:/DEV/agent-viz add bin/agent-viz.js
git -C F:/DEV/agent-viz commit -m "$(cat <<'EOF'
cli: add --target flag for install-hooks/uninstall-hooks/--check

Default install behavior auto-detects which agents are installed
locally and writes hooks for each. --target=claude|copilot|both
overrides detection. Output formatted per-agent ("Claude Code:" /
"Copilot CLI:") for clarity in the dual-agent case.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: preuninstall script extends to Copilot

**Files:**
- Modify: `lib/preuninstall.js`

The `preuninstall` script calls `uninstall({ cwd })`. With Task 6, that now returns `{ claude, copilot }` so it already handles both agents — but the iteration logic was tied to `result.results`. Update to iterate the new shape.

- [ ] **Step 1: Iterate the new return shape**

Replace the body of `lib/preuninstall.js` with:
```js
'use strict';
// Invoked by npm during `npm uninstall agent-viz` via the `preuninstall`
// lifecycle script. Best-effort hook cleanup so the user doesn't end up
// with agent settings pointing at a deleted binary.
//
// Never blocks the uninstall — every error is logged and swallowed.
//
// cwd note: npm runs lifecycle scripts with cwd = the package directory
// itself (e.g. .../node_modules/agent-viz). For local installs that's the
// wrong starting point — findProjectRoot would stop at the package and
// miss the user's actual project. INIT_CWD is npm's record of where the
// user originally invoked the command, which is what we want.

try {
  const { uninstall } = require('./install-hooks');
  const cwd = process.env.INIT_CWD || process.cwd();
  const result = uninstall({ cwd });
  let total = 0;
  for (const [agent, x] of Object.entries(result)) {
    const results = x.results || [];
    const label = agent === 'claude' ? 'Claude Code' : 'Copilot CLI';
    for (const r of results) {
      if (r.removed > 0) {
        console.log(`agent-viz: removed ${r.removed} ${label} hook(s) from ${r.file}`);
        total += r.removed;
      }
    }
  }
  if (total === 0) console.log('agent-viz: no hooks to remove.');
} catch (e) {
  console.error(`agent-viz: hook cleanup skipped (${e.message})`);
}
```

- [ ] **Step 2: Smoke test — preuninstall removes both kinds**

```bash
TMPDIR=$(node -e "console.log(require('os').tmpdir())")
TEST_HOME="$TMPDIR/agentviz-test-preuninstall"
rm -rf "$TEST_HOME"
mkdir -p "$TEST_HOME"

# Install both
HOME="$TEST_HOME" USERPROFILE="$TEST_HOME" node F:/DEV/agent-viz/bin/agent-viz.js install-hooks --target=both --user

# Run the preuninstall script directly
HOME="$TEST_HOME" USERPROFILE="$TEST_HOME" INIT_CWD="$TEST_HOME" node F:/DEV/agent-viz/lib/preuninstall.js

# Verify both are gone
node -e "
  const fs=require('fs'),path=require('path');
  const claudePath=path.join('$TEST_HOME','.claude','settings.json');
  const copilotPath=path.join('$TEST_HOME','.copilot','hooks','agent-viz.json');
  if(fs.existsSync(copilotPath)){console.error('FAIL: copilot file still there');process.exit(1);}
  if(fs.existsSync(claudePath)){
    const s=JSON.parse(fs.readFileSync(claudePath,'utf8'));
    if(s.hooks&&Object.keys(s.hooks).length>0){console.error('FAIL: claude hooks still there');process.exit(1);}
  }
  console.log('PASS: both cleaned up by preuninstall');
"

rm -rf "$TEST_HOME"
```
Expected: `PASS: both cleaned up by preuninstall`.

- [ ] **Step 3: Commit**

```bash
git -C F:/DEV/agent-viz add lib/preuninstall.js
git -C F:/DEV/agent-viz commit -m "$(cat <<'EOF'
preuninstall: iterate multi-agent uninstall result shape

uninstall() now returns { claude, copilot }; the preuninstall lifecycle
script iterates both keys so npm uninstall sweeps Copilot hook files
alongside Claude settings.json entries.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Frontend — badge CSS + topbar element

**Files:**
- Modify: `index.html`

Add the `.agent-badge` CSS rule (with two color modifiers) and a `<span id="topbar-agent">` element next to the logo.

- [ ] **Step 1: Add `.agent-badge` CSS**

In `index.html`, find the closing `}` of the `.logo` selector (around line 60) and inject the new badge styles right after the `.logo-icon` block (after line 67):
```css
.agent-badge {
  font-size: 9px; text-transform: uppercase; letter-spacing: 0.6px;
  font-weight: 600; padding: 2px 7px; border-radius: 4px;
  border: 1px solid currentColor;
  background: rgba(102, 204, 255, 0.06);
  color: var(--holo);
  white-space: nowrap;
}
.agent-badge.agent-copilot {
  color: var(--agent);
  background: rgba(188, 140, 255, 0.06);
}
.agent-badge.agent-claude {
  color: var(--holo);
  background: rgba(102, 204, 255, 0.06);
}
.session-card .agent-badge {
  margin-left: 6px;
  vertical-align: middle;
}
#topbar-agent { display: none; }
#topbar-agent.visible { display: inline-block; }
```

- [ ] **Step 2: Add the topbar badge element**

In `index.html`, find the `.logo` div (around line 270-273):
```html
    <div class="logo">
      <div class="logo-icon">&#x25C8;</div>
      agent-viz
    </div>
```
Replace with:
```html
    <div class="logo">
      <div class="logo-icon">&#x25C8;</div>
      agent-viz
      <span id="topbar-agent" class="agent-badge"></span>
    </div>
```

- [ ] **Step 3: Smoke test — visual check after Task 10**

This step's verification is bundled with Task 10 since the badges are populated by JS. Move on.

- [ ] **Step 4: Commit**

```bash
git -C F:/DEV/agent-viz add index.html
git -C F:/DEV/agent-viz commit -m "$(cat <<'EOF'
ui: add agent-badge CSS + topbar badge element

Holo cyan for Claude, agent violet for Copilot — both colors already in
the palette so no new tokens. Topbar badge starts hidden; viz-network.js
toggles .visible based on the active session's agentSource.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Frontend — render badges from session metadata

**Files:**
- Modify: `public/viz-network.js`

Render the badge on each session card from `s.agentSource`, and update the topbar badge whenever the active session changes.

- [ ] **Step 1: Add a helper that renders a badge HTML snippet**

In `public/viz-network.js`, at the top of the file (right after the `import` statements, line 13), add:
```js
// Render a small pill badge identifying the source agent. Returns HTML safe to
// inline (label is fixed, no user input).
function badgeHtml(agentSource) {
  const src = agentSource === 'copilot' ? 'copilot' : 'claude';
  return `<span class="agent-badge agent-${src}">${src}</span>`;
}
```

- [ ] **Step 2: Track agentSource per session id**

In `public/viz-network.js`, find:
```js
export const sessionTitles = new Map();
```
Right after that line, add:
```js
export const sessionAgents = new Map(); // sid → 'claude' | 'copilot'
```

- [ ] **Step 3: Populate `sessionAgents` and render badge on session cards**

In `loadSessions()` (around line 145), find the existing `for (const s of sessions) { ... }` loop:
```js
    for (const s of sessions) {
      if (s.prompt) sessionTitles.set(s.id, s.prompt);
    }
```
Replace with:
```js
    for (const s of sessions) {
      if (s.prompt) sessionTitles.set(s.id, s.prompt);
      sessionAgents.set(s.id, s.agentSource || 'claude');
    }
```

In the same function, find the `.map(s => ...)` rendering block:
```js
      sessions.map(s => `
        <div class="session-card${currentSessionId === s.id ? ' active' : ''}" data-sid="${s.id}">
          <div class="s-title">${esc(s.id.slice(0, 8))}</div>
          ${s.prompt ? `<div class="s-prompt">${esc(s.prompt)}</div>` : ''}
          <div class="s-meta">
            <span>${s.eventCount || 0} events</span>
            <span>${formatAge(s.mtime)}</span>
          </div>
        </div>
      `).join('');
```
Replace with:
```js
      sessions.map(s => `
        <div class="session-card${currentSessionId === s.id ? ' active' : ''}" data-sid="${s.id}">
          <div class="s-title">${esc(s.id.slice(0, 8))}${badgeHtml(s.agentSource)}</div>
          ${s.prompt ? `<div class="s-prompt">${esc(s.prompt)}</div>` : ''}
          <div class="s-meta">
            <span>${s.eventCount || 0} events</span>
            <span>${formatAge(s.mtime)}</span>
          </div>
        </div>
      `).join('');
```

- [ ] **Step 4: Update topbar badge in `updateTopbarPrompt`**

The topbar badge needs to update whenever the topbar prompt does (same trigger: active session changed). Modify `updateTopbarPrompt`:
```js
export function updateTopbarPrompt() {
  const sid = currentSessionId || state._lastServerId;
  const el = document.getElementById('topbar-prompt');
  const prompt = sid ? sessionTitles.get(sid) : null;
  el.textContent = prompt || '';
  el.title = prompt || '';
  // Topbar agent badge follows the active session.
  const badge = document.getElementById('topbar-agent');
  if (badge) {
    const agent = sid ? sessionAgents.get(sid) : null;
    if (agent) {
      badge.textContent = agent;
      badge.className = `agent-badge agent-${agent === 'copilot' ? 'copilot' : 'claude'} visible`;
    } else {
      badge.className = 'agent-badge';
      badge.textContent = '';
    }
  }
}
```

- [ ] **Step 5: Smoke test — start server and visually inspect**

```bash
# Stop any running server
node F:/DEV/agent-viz/bin/agent-viz.js stop 2>/dev/null

# Seed sessions
TMPDIR=$(node -e "console.log(require('os').tmpdir())")
mkdir -p "$TMPDIR/agent-events"
echo '{"hook_event_name":"SessionStart","session_id":"badge-test-claude","_source":"claude","_ts":"2026-05-06T00:00:00.000Z"}' > "$TMPDIR/agent-events/badge-test-claude.jsonl"
echo '{"hook_event_name":"SessionStart","session_id":"badge-test-copilot","_source":"copilot","_ts":"2026-05-06T00:00:00.000Z"}' > "$TMPDIR/agent-events/badge-test-copilot.jsonl"

node F:/DEV/agent-viz/bin/agent-viz.js start --foreground --no-install-hooks --port 3334 &
SERVER_PID=$!
sleep 2

echo ""
echo "→ Open http://localhost:3334 in your browser"
echo "→ Click 'Sessions' (bottom-left button)"
echo "→ Verify TWO session cards appear, each with a colored pill badge:"
echo "    - badge-tes (cyan 'claude')"
echo "    - badge-tes (violet 'copilot')"
echo "→ Click on each in turn — verify the topbar shows the matching badge next to 'agent-viz'"
echo ""
echo "Press ENTER to clean up..."
read
kill $SERVER_PID 2>/dev/null
rm "$TMPDIR/agent-events/badge-test-claude.jsonl" "$TMPDIR/agent-events/badge-test-copilot.jsonl"
```
Expected: visual confirmation. Two cards with distinct badges, topbar badge updates on session switch.

- [ ] **Step 6: Commit**

```bash
git -C F:/DEV/agent-viz add public/viz-network.js
git -C F:/DEV/agent-viz commit -m "$(cat <<'EOF'
ui: render source-agent badges on session cards + topbar

Each /sessions response now carries agentSource per session; the dashboard
maps it to a colored pill (cyan = claude, violet = copilot) on the session
card and a synced badge in the topbar that follows the active session.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Docs — README + package.json bump

**Files:**
- Modify: `README.md`
- Modify: `package.json`

- [ ] **Step 1: Bump version + update description in `package.json`**

Open `F:/DEV/agent-viz/package.json` and:
- Bump `"version"` from `0.1.1` to `0.2.0`.
- Update `"description"` (if present) to `"Real-time visualizer for Claude Code and GitHub Copilot CLI sessions. Streams hook events into a live web dashboard with multi-agent topology, token usage, and tool-call timeline."`.

If `description` doesn't exist, add it at the top alongside `name`/`version`. Use the `Edit` tool for these changes.

- [ ] **Step 2: Update README intro paragraph**

In `README.md` lines 1-3, replace:
```markdown
# agent-viz

Real-time visualizer for [Claude Code](https://docs.claude.com/en/docs/claude-code) sessions. Streams hook events into a live web dashboard with multi-agent topology, token usage, and tool-call timeline.
```
with:
```markdown
# agent-viz

Real-time visualizer for [Claude Code](https://docs.claude.com/en/docs/claude-code) and [GitHub Copilot CLI](https://docs.github.com/en/copilot/concepts/agents/about-copilot-cli) sessions. Streams hook events into a live web dashboard with per-agent badges, multi-agent topology, token usage, and tool-call timeline.
```

- [ ] **Step 3: Add a "Multi-agent support" section + update Hook management**

After the "Daily usage" table (after line 56), insert a new section:
```markdown
## Multi-agent support

agent-viz captures events from **both Claude Code and GitHub Copilot CLI** simultaneously. On first run, it auto-detects which CLI agents are installed locally and registers the appropriate hooks for each. Sessions are tagged in the dashboard with a colored pill badge (cyan for Claude, violet for Copilot).

To force a target explicitly:

```bash
agent-viz install-hooks --target=claude     # Claude only
agent-viz install-hooks --target=copilot    # Copilot only
agent-viz install-hooks --target=both       # both even if not detected
```

Detection: an agent is considered installed if its CLI binary is on your `PATH`, or if its config home (`~/.claude/` for Claude, `~/.copilot/` for Copilot) exists with at least one file inside.
```

- [ ] **Step 4: Update the "Hook management" section to cover both agents**

Replace the bullet list of default install paths (lines 59-63) with:
```markdown
The first time you run `agent-viz`, it auto-registers hooks for the agents it detects. By default they go to:

| Agent | When inside a project | Outside a project |
|---|---|---|
| Claude Code | `<root>/.claude/settings.local.json` (gitignored) | `~/.claude/settings.json` |
| Copilot CLI | `<root>/.github/hooks/agent-viz.local.json` (gitignored) | `~/.copilot/hooks/agent-viz.json` |
```

- [ ] **Step 5: Update "Captured events" section**

Replace line 141:
```markdown
`UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`, `SessionStart`. Events land as JSONL in `${tmpdir}/claude-events/<session_id>.jsonl` and are streamed to the dashboard via Server-Sent Events.
```
with:
```markdown
`UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`, `SessionStart`. Events land as JSONL in `${tmpdir}/agent-events/<session_id>.jsonl` (legacy `claude-events/` is still read by the server until v0.4.0) and are streamed to the dashboard via Server-Sent Events. Each event carries a `_source: "claude" | "copilot"` field set by the hook command's `--source` flag.
```

- [ ] **Step 6: Smoke verify the new help output**

```bash
node F:/DEV/agent-viz/bin/agent-viz.js --help
```
Expected: help text mentions `--target`, mentions both Claude and Copilot config paths.

- [ ] **Step 7: Commit**

```bash
git -C F:/DEV/agent-viz add README.md package.json
git -C F:/DEV/agent-viz commit -m "$(cat <<'EOF'
docs: bump to 0.2.0, document multi-agent support

README gains a Multi-agent support section, an updated Hook management
table covering both agents' default paths, and a note on the new
agent-events/ directory and _source field. Description updated to reflect
both supported agents.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: End-to-end smoke test

**Files:** none changed.

Validate the full installation → hook firing → dashboard rendering loop with both agents (or as many as the user has installed).

- [ ] **Step 1: Clean state**

```bash
node F:/DEV/agent-viz/bin/agent-viz.js stop 2>/dev/null
node F:/DEV/agent-viz/bin/agent-viz.js uninstall-hooks
TMPDIR=$(node -e "console.log(require('os').tmpdir())")
rm -rf "$TMPDIR/agent-events" "$TMPDIR/claude-events"
```

- [ ] **Step 2: Fresh install + start**

```bash
node F:/DEV/agent-viz/bin/agent-viz.js
```
Expected: prints `Claude Code:` and (if Copilot detected) `Copilot CLI:` install lines. Then "started" line.

- [ ] **Step 3: Audit the install**

```bash
node F:/DEV/agent-viz/bin/agent-viz.js install-hooks --check
```
Expected: exit 0, all five events show `[x]` for each detected agent.

- [ ] **Step 4: Run Claude Code, observe events**

In a separate terminal, run any Claude Code session. Issue at least one tool call (e.g., `ls`). Open http://localhost:3333 in a browser.

Expected: a session card appears with a cyan `claude` badge. Topbar badge shows `claude` when that session is active.

- [ ] **Step 5: Run Copilot CLI (if installed), observe events**

In a separate terminal, run `copilot` (or `gh copilot`). Issue at least one prompt that calls a tool.

Expected: a second session card appears with a violet `copilot` badge. Topbar badge updates to `copilot` when that session is selected.

- [ ] **Step 6: Verify cross-agent isolation**

While both sessions exist, switch between them in the Sessions overlay. Each one's canvas, feed, and topbar prompt update correctly.

- [ ] **Step 7: Uninstall + verify clean removal**

```bash
node F:/DEV/agent-viz/bin/agent-viz.js uninstall-hooks
node F:/DEV/agent-viz/bin/agent-viz.js install-hooks --check
```
Expected: all five events show `[ ]` for each agent. Exit code 1.

Verify on disk:
```bash
ls ~/.claude/settings.json 2>&1 | grep -i hook   # claude file may exist but with no hooks
ls ~/.copilot/hooks/agent-viz.json 2>&1          # should not exist
```

- [ ] **Step 8: Reinstall to leave the system in a working state**

```bash
node F:/DEV/agent-viz/bin/agent-viz.js install-hooks
node F:/DEV/agent-viz/bin/agent-viz.js status
```

If all 7 steps pass, the implementation is complete and ready for daily use.

---

## Self-review checklist (run after writing the plan)

- [ ] **Spec coverage:** every D# decision in the design spec has at least one task that implements it (D1→T9/T10, D2→T5, D3→T2, D4→T2/T4/T5, D5→T1/T2, D6→T6/T7, D7→T9/T10).
- [ ] **Placeholder scan:** no "TBD"/"TODO"/"appropriate error handling"/"similar to Task N".
- [ ] **Type/name consistency:** `agentSource` is the field name used everywhere (server, frontend, sessionAgents map). `_source` is the JSONL field. `--source=<agent>` is the CLI flag. All consistent.
- [ ] **No reference to undefined helpers:** every helper used (e.g., `sessionFilePath`, `badgeHtml`, `installCopilot`, `resolveCopilotScope`) is defined in an earlier step of the same or a prior task.

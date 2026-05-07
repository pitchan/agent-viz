// viz-narrator.js — Live narrator: heuristic + dirty/render driver.
//
// Pure decision module. Given state + vis + now, returns the one-line caption
// to display under the topbar. No DOM, no fetch — render is plugged in via
// setRenderFn() by viz-ui.js. Tests can import composeNarrator/commonPathPrefix
// without triggering any side effect (no setInterval at import time).

// ─── commonPathPrefix ─────────────────────────────────────────────────────
// Returns the common directory prefix of the given paths (e.g. "auth/" for
// ["auth/x.js", "auth/y.js"]). Returns null if fewer than 2 paths or if no
// common directory boundary exists.
export function commonPathPrefix(paths) {
  if (!paths || paths.length < 2) return null;
  const dirSegs = paths.map(p => {
    const segs = String(p).split(/[\\/]/);
    segs.pop(); // drop the filename
    return segs;
  });
  let i = 0;
  outer: while (true) {
    const seg = dirSegs[0][i];
    if (seg === undefined) break;
    for (let k = 1; k < dirSegs.length; k++) {
      if (dirSegs[k][i] !== seg) break outer;
    }
    i++;
  }
  if (i === 0) return null;
  return dirSegs[0].slice(0, i).join('/') + '/';
}

// ─── composeNarrator ──────────────────────────────────────────────────────
// Returns null | { text, tone } where tone ∈ 'active'|'idle'|'error'|'done'.
//
// Contract: pure. Reads state.nodes, state.timelineEntries, state.toolsCompleted,
// vis.runningNodes. Never mutates. Never throws on partial state (returns null).
export function composeNarrator(state, vis, now) {
  if (!state || !state.nodes || state.nodes.size === 0) return null;

  let session = null;
  for (const n of state.nodes.values()) {
    if (n.type === 'session' && !n.parentId) { session = n; break; }
  }
  if (!session) return null;

  if (!state.timelineEntries || state.timelineEntries.length === 0) return null;

  if (session.status === 'done') {
    const dur = formatSessionDuration(session.startTime, session.endTime);
    return {
      text: `session done · ${state.toolsCompleted || 0} tools · ${dur}`,
      tone: 'done',
    };
  }

  const primary = computePrimary(state, vis, now);
  const context = computeContext(state, vis);
  const recent = computeRecent(state, vis, now);

  const parts = [];
  if (primary) parts.push(primary.text);
  if (context) parts.push(context);
  if (recent) parts.push(recent.text);

  if (parts.length === 0) return null;

  const tone = recent && recent.isError ? 'error'
    : primary && primary.isIdle ? 'idle'
    : 'active';

  return { text: parts.join(' · '), tone };
}

// ─── Internal helpers ─────────────────────────────────────────────────────
function computePrimary(state, vis, now) {
  const mainRunning = [];
  for (const id of vis.runningNodes) {
    const n = state.nodes.get(id);
    if (!n) continue;
    if (n.type !== 'tool' && n.type !== 'skill' && n.type !== 'mcp') continue;
    const parent = n.parentId ? state.nodes.get(n.parentId) : null;
    if (parent && parent.type === 'session') mainRunning.push(n);
  }
  if (mainRunning.length > 0) {
    return { text: aggregateRunning(mainRunning), isIdle: false };
  }

  const agentRunCounts = new Map();
  for (const id of vis.runningNodes) {
    const n = state.nodes.get(id);
    if (!n || (n.type !== 'tool' && n.type !== 'skill' && n.type !== 'mcp')) continue;
    const parent = n.parentId ? state.nodes.get(n.parentId) : null;
    if (parent && parent.type === 'agent') {
      agentRunCounts.set(parent.id, (agentRunCounts.get(parent.id) || 0) + 1);
    }
  }
  if (agentRunCounts.size > 0) {
    let topId = null, topN = 0;
    for (const [id, n] of agentRunCounts) {
      if (n > topN) { topId = id; topN = n; }
    }
    const agent = state.nodes.get(topId);
    if (agent) return { text: agent.label || 'agent', isIdle: false };
  }

  const idleS = computeIdleSeconds(state, now);
  if (idleS != null) {
    return { text: `idle ${idleS}s`, isIdle: true };
  }
  return null;
}

function computeIdleSeconds(state, now) {
  const entries = state.timelineEntries;
  let lastEnd = null;
  for (let i = entries.length - 1; i >= 0 && i >= entries.length - 50; i--) {
    const n = state.nodes.get(entries[i].nodeId);
    if (!n || !n.endTime) continue;
    const t = +new Date(n.endTime);
    if (!Number.isFinite(t)) continue;
    if (lastEnd == null || t > lastEnd) lastEnd = t;
  }
  if (lastEnd == null) return null;
  return Math.max(0, Math.round((now - lastEnd) / 1000));
}

function computeRecent(state, vis, now) {
  const entries = state.timelineEntries;
  let lastError = null, lastDone = null;
  for (let i = entries.length - 1; i >= 0 && i >= entries.length - 50; i--) {
    const n = state.nodes.get(entries[i].nodeId);
    if (!n || !n.endTime) continue;
    if (n.type !== 'tool' && n.type !== 'skill' && n.type !== 'mcp') continue;
    if (!lastError && n.status === 'error') lastError = n;
    if (!lastDone && n.status === 'done') lastDone = n;
    if (lastError && lastDone) break;
  }
  if (lastError) {
    const ago = Math.round((now - +new Date(lastError.endTime)) / 1000);
    if (ago < 60) return { text: `err ${ago}s`, isError: true };
  }
  if (lastDone) {
    const ago = Math.round((now - +new Date(lastDone.endTime)) / 1000);
    if (ago < 10) return { text: `${lastDone.label} done`, isError: false };
  }
  return null;
}

function aggregateRunning(tools) {
  if (tools.length === 1) return tools[0].label;
  const counts = new Map();
  for (const t of tools) counts.set(t.label, (counts.get(t.label) || 0) + 1);
  let topLabel = null, topCount = 0;
  for (const [k, v] of counts) {
    if (v > topCount) { topLabel = k; topCount = v; }
  }
  const others = tools.length - topCount;
  const plural = pluralize(topLabel, topCount);
  return others > 0 ? `${topCount} ${plural} +${others}` : `${topCount} ${plural}`;
}

function pluralize(label, n) {
  if (n <= 1) return label;
  return label.toLowerCase() + 's';
}

// Context slot: hot directory derived from recent file tools. Sub-agent
// branches are added in later tasks. Returns a string or null.
function computeContext(state, vis) {
  const filePaths = [];
  const entries = state.timelineEntries;
  for (let i = entries.length - 1; i >= 0 && filePaths.length < 5; i--) {
    const e = entries[i];
    if (e.type !== 'tool') continue;
    if (e.label !== 'Read' && e.label !== 'Edit' && e.label !== 'Write') continue;
    if (!e.sub) continue;
    filePaths.push(e.sub);
  }
  for (const id of vis.runningNodes) {
    const n = state.nodes.get(id);
    if (!n) continue;
    if (n.label !== 'Read' && n.label !== 'Edit' && n.label !== 'Write') continue;
    if (n.sub && !filePaths.includes(n.sub)) filePaths.push(n.sub);
  }
  return commonPathPrefix(filePaths);
}

function formatSessionDuration(startIso, endIso) {
  if (!startIso || !endIso) return '?';
  const ms = new Date(endIso) - new Date(startIso);
  if (!Number.isFinite(ms) || ms < 0) return '?';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

// ─── Dirty / render driver ────────────────────────────────────────────────
// viz-ui.js wires renderNarrator() via setRenderFn() at module init. Bursts
// of markNarratorDirty() coalesce into a single render per microtask. The
// 1 Hz tick (resumeTick / pauseTick) just calls markNarratorDirty() —
// "Xs ago" clocks are advanced by the same render path as event-driven
// updates.
let _renderFn = null;
let _pending = false;
let _tickHandle = null;

export function setRenderFn(fn) {
  _renderFn = typeof fn === 'function' ? fn : null;
}

export function markNarratorDirty() {
  if (_pending) return;
  _pending = true;
  queueMicrotask(() => {
    _pending = false;
    if (_renderFn) _renderFn();
  });
}

export function resumeTick() {
  if (_tickHandle != null) return;
  _tickHandle = setInterval(markNarratorDirty, 1000);
}

export function pauseTick() {
  if (_tickHandle == null) return;
  clearInterval(_tickHandle);
  _tickHandle = null;
}

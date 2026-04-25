// viz-layout.js — node mutation, event ingestion, orbital layout, GC.
//
// Converts raw hook events into the node graph (state.nodes), keeps the vis
// layer in sync (ensureVisNode + draw buckets), runs incremental orbital
// layout, and GCs old finished nodes. Pure: no DOM, no rendering, no fetch.

import {
  COLORS, SPAWN_DIST, TIMELINE_CAP, NODE_GC_MAX_AGE_MS,
  state, vis, markDirty, parseMcpName,
} from './viz-state.js';

// ─── Feed-cursor adjust hook ──────────────────────────────────────────────
// When the timeline ring-buffer shifts, viz-ui's _feedRenderedCount must be
// decremented by the drop count so incremental append keeps working. Injected
// by viz-ui at load time to avoid a circular import.
let _feedCursorAdjust = () => {};
export function setFeedCursorAdjust(fn) { _feedCursorAdjust = fn || (() => {}); }

// ─── Node creation ────────────────────────────────────────────────────────
export function getNode(id) {
  if (!state.nodes.has(id)) {
    state.nodes.set(id, {
      id, type: 'tool', label: '', sub: '', color: COLORS.tool,
      children: [], parentId: null, data: null, status: 'running',
      x: 0, y: 0, duration: null, startTime: null, endTime: null,
      isIsolated: false, isParallel: false,
    });
  }
  return state.nodes.get(id);
}

export function ensureVisNode(id) {
  if (!vis.nodes.has(id)) {
    const n = state.nodes.get(id);
    const parent = n && n.parentId ? vis.nodes.get(n.parentId) : null;
    const startX = parent ? parent.x : 0;
    const startY = parent ? parent.y : 0;
    const vn = {
      id,
      x: startX, y: startY,
      targetX: 0, targetY: 0,
      opacity: 0, targetOpacity: 1,
      scale: 0.3, targetScale: 1,
      glowPhase: Math.random() * Math.PI * 2,
    };
    vis.nodes.set(id, vn);
    if (n) {
      const bucket = n.type === 'session' ? vis.drawSessionNodes
        : n.type === 'agent' ? vis.drawAgentNodes
        : n.type === 'skill' ? vis.drawSkillNodes
        : n.type === 'mcp' ? vis.drawMcpNodes
        : vis.drawToolNodes;
      bucket.push({ n, vn });
    }
  }
  return vis.nodes.get(id);
}

export function addTimelineEntry(evt, nodeId, type, label, sub) {
  state.timelineEntries.push({
    ts: evt._ts || new Date().toISOString(),
    nodeId, type, label, sub: sub || '',
  });
  if (state.timelineEntries.length > TIMELINE_CAP + 50) {
    const drop = state.timelineEntries.length - TIMELINE_CAP;
    state.timelineEntries.splice(0, drop);
    _feedCursorAdjust(drop);
  }
}

export function setRunning(id, on) {
  if (on) vis.runningNodes.add(id);
  else vis.runningNodes.delete(id);
}

// Lazy-promote a node created by getNode('a:<aid>') with default type='tool'
// into a real agent node. Claude Code does not emit SubagentStart hooks today,
// so the first child PreToolUse carrying agent_id is our spawn signal.
// Child events also carry agent_type, so we have a real label immediately.
function promoteAgentNode(n, evt, sid, ts) {
  n.type = 'agent';
  n.label = evt.agent_type || evt.subagent_type || 'Agent';
  if (!n.sub) n.sub = (evt.agent_id || '').slice(0, 8);
  n.color = COLORS.agent;
  n.status = 'running';
  if (!n.startTime) n.startTime = ts;
  setRunning(n.id, true);
  if (!n.parentId) {
    const aid = (evt.agent_id || n.id.slice(2));
    const forkedParentAid = state.forkedAgentParents.get(aid);
    const forkedParent = forkedParentAid ? state.nodes.get(`a:${forkedParentAid}`) : null;
    let parent;
    if (forkedParent) {
      parent = forkedParent;
    } else {
      parent = getNode(`s:${sid}`);
      parent.type = 'session';
      parent.label = parent.label || 'Session';
      parent.color = COLORS.session;
    }
    n.parentId = parent.id;
    parent.children.push(n);
    recomputeParallelFlags(parent.id);
  }
  addTimelineEntry(evt, n.id, 'agent', n.label, n.sub);
}

// Detach `n` from its current parent's children list and attach it under
// `newParentId`. No-op if newParent is unknown or already the parent.
function reparentNode(n, newParentId) {
  if (!n || !newParentId || n.parentId === newParentId) return;
  const newParent = state.nodes.get(newParentId);
  if (!newParent) return;
  const oldParent = n.parentId ? state.nodes.get(n.parentId) : null;
  if (oldParent) {
    const idx = oldParent.children.indexOf(n);
    if (idx >= 0) oldParent.children.splice(idx, 1);
  }
  n.parentId = newParent.id;
  newParent.children.push(n);
  if (oldParent) recomputeParallelFlags(oldParent.id);
  recomputeParallelFlags(newParent.id);
  markLayoutDirty(n);
}

// Mark all running agents under this session as parallel if 2+ run at once.
// Sticky: once flagged, an agent keeps isParallel=true for the rest of its life.
export function recomputeParallelFlags(sessionId) {
  const session = state.nodes.get(sessionId);
  if (!session) return;
  const runningAgents = session.children.filter(c =>
    c.type === 'agent' && c.status === 'running'
  );
  if (runningAgents.length >= 2) {
    for (const a of runningAgents) a.isParallel = true;
  }
}

// On SessionEnd, close every descendant that was still running so particle
// generation (which iterates vis.runningNodes) stops immediately.
export function cascadeTerminate(rootNodeId, ts) {
  const root = state.nodes.get(rootNodeId);
  if (!root) return;
  const stack = [...(root.children || [])];
  while (stack.length) {
    const n = stack.pop();
    if (n.status === 'running') {
      n.status = 'done';
      n.endTime = ts;
      n.duration = calcDuration(n.startTime, ts);
      setRunning(n.id, false);
    }
    if (n.children && n.children.length) {
      for (const c of n.children) stack.push(c);
    }
  }
}

// ─── Event → graph mutation ───────────────────────────────────────────────
export function processEvent(evt) {
  const sid = evt.session_id || 'unknown';
  const e = evt.hook_event_name;
  const ts = evt._ts || new Date().toISOString();
  layoutDirtyRoots.add(`s:${sid}`);

  if (e === 'SessionStart') {
    const n = getNode(`s:${sid}`);
    n.type = 'session'; n.label = 'Session'; n.sub = sid.slice(0, 8);
    n.color = COLORS.session; n.data = evt; n.status = 'running'; n.startTime = ts;
    setRunning(n.id, true);
    addTimelineEntry(evt, n.id, 'session', 'Session', sid.slice(0, 8));
  }
  else if (e === 'SubagentStart') {
    const aid = evt.agent_id || sid;
    const n = getNode(`a:${aid}`);
    n.type = 'agent';
    n.label = evt.agent_type || evt.subagent_type || 'Agent';
    n.sub = (evt.tool_input && evt.tool_input.description) || aid.slice(0, 8);
    n.color = COLORS.agent; n.data = evt; n.status = 'running'; n.startTime = ts;
    if (evt.tool_input && evt.tool_input.isolation === 'worktree') n.isIsolated = true;
    setRunning(n.id, true);
    const parent = getNode(`s:${sid}`);
    parent.type = 'session'; parent.label = parent.label || 'Session'; parent.color = COLORS.session;
    if (!n.parentId) { n.parentId = parent.id; parent.children.push(n); }
    recomputeParallelFlags(parent.id);
    addTimelineEntry(evt, n.id, 'agent', n.label, n.sub);
  }
  else if (e === 'SubagentStop') {
    const aid = evt.agent_id || sid;
    const n = state.nodes.get(`a:${aid}`);
    if (n) {
      n.status = 'done'; n.data = evt; n.endTime = ts; n.duration = calcDuration(n.startTime, ts); n.color = COLORS.complete; setRunning(n.id, false);
      if (n.parentId) recomputeParallelFlags(n.parentId);
    }
  }
  else if (e === 'PreToolUse') {
    const tid = evt.tool_use_id || `t${state.eventSeq++}`;
    const n = getNode(`t:${tid}`);
    const isSkill = evt.tool_name === 'Skill';
    const isMcp = typeof evt.tool_name === 'string' && evt.tool_name.startsWith('mcp__');
    n.type = isSkill ? 'skill' : isMcp ? 'mcp' : 'tool';
    if (isMcp) {
      const parsed = parseMcpName(evt.tool_name);
      n.label = parsed.label;
      n.sub = parsed.sub;
    } else {
      n.label = isSkill ? ((evt.tool_input && evt.tool_input.skill) || 'Skill') : (evt.tool_name || 'Tool');
      n.sub = formatToolSub(evt);
    }
    n.color = isSkill ? COLORS.skill : isMcp ? COLORS.mcp : COLORS.tool;
    n.data = evt; n.status = 'running'; n.startTime = ts;
    setRunning(n.id, true);
    state.startTimes.set(tid, ts);
    const parentId = evt.agent_id ? `a:${evt.agent_id}` : `s:${sid}`;
    const parent = getNode(parentId);
    if (parentId.startsWith('s:')) {
      parent.type = 'session'; parent.label = parent.label || 'Session'; parent.color = COLORS.session;
    } else if (parent.type !== 'agent') {
      promoteAgentNode(parent, evt, sid, ts);
    }
    if (!n.parentId) { n.parentId = parent.id; parent.children.push(n); }
    addTimelineEntry(evt, n.id, n.type, n.label, n.sub);
  }
  else if (e === 'PostToolUse') {
    const tid = evt.tool_use_id || '';
    const n = state.nodes.get(`t:${tid}`);
    if (n) { n.status = 'done'; n.data = evt; n.endTime = ts; n.duration = calcDuration(n.startTime, ts); state.toolsCompleted++; setRunning(n.id, false); }
    // Subagent completion: PostToolUse on the main-thread Agent tool carries
    // tool_response.agentId. This is the canonical "subagent done" signal,
    // since SubagentStop hooks are not reliably emitted.
    if (evt.tool_name === 'Agent') {
      const aid = evt.tool_response && evt.tool_response.agentId;
      const an = aid ? state.nodes.get(`a:${aid}`) : null;
      if (an && an.status === 'running') {
        an.status = 'done';
        an.endTime = ts;
        an.duration = calcDuration(an.startTime, ts);
        an.color = COLORS.complete;
        setRunning(an.id, false);
        const desc = evt.tool_input && evt.tool_input.description;
        if (desc) an.sub = desc.slice(0, 45);
        if (an.parentId) recomputeParallelFlags(an.parentId);
      }
    }
    // Skill fork → record the parent mapping and reparent the forked sub-agent
    // under its launching agent. The child's first PreToolUse arrives before
    // this PostToolUse, so the child is initially attached to the session by
    // promoteAgentNode and must be moved retroactively here.
    if (evt.tool_name === 'Skill' && evt.tool_response
        && evt.tool_response.status === 'forked' && evt.tool_response.agentId
        && evt.agent_id) {
      const childAid = evt.tool_response.agentId;
      const parentAid = evt.agent_id;
      state.forkedAgentParents.set(childAid, parentAid);
      const childNode = state.nodes.get(`a:${childAid}`);
      if (childNode) reparentNode(childNode, `a:${parentAid}`);
    }
  }
  else if (e === 'PostToolUseFailure') {
    const tid = evt.tool_use_id || '';
    const n = state.nodes.get(`t:${tid}`);
    if (n) { n.status = 'error'; n.color = COLORS.error; n.data = evt; n.endTime = ts; n.duration = calcDuration(n.startTime, ts); setRunning(n.id, false); }
    if (evt.tool_name === 'Agent') {
      const aid = evt.tool_response && evt.tool_response.agentId;
      const an = aid ? state.nodes.get(`a:${aid}`) : null;
      if (an && an.status === 'running') {
        an.status = 'error'; an.color = COLORS.error;
        an.endTime = ts; an.duration = calcDuration(an.startTime, ts);
        setRunning(an.id, false);
        if (an.parentId) recomputeParallelFlags(an.parentId);
      }
    }
  }
  else if (e === 'Notification') {
    const nid = `n:${state.eventSeq++}`;
    const n = getNode(nid);
    n.type = 'notification'; n.label = 'Notification'; n.sub = (evt.message || '').slice(0, 50);
    n.color = COLORS.notification; n.data = evt; n.status = 'done';
    const parent = getNode(`s:${sid}`);
    parent.type = 'session'; parent.label = parent.label || 'Session'; parent.color = COLORS.session;
    if (!n.parentId) { n.parentId = parent.id; parent.children.push(n); }
    addTimelineEntry(evt, nid, 'notification', 'Notification', n.sub);
  }
  else if (e === 'Stop' || e === 'SessionEnd') {
    const n = state.nodes.get(`s:${sid}`);
    if (n) {
      n.status = 'done'; n.data = evt; n.endTime = ts; n.duration = calcDuration(n.startTime, ts); n.color = COLORS.complete; setRunning(n.id, false);
      cascadeTerminate(n.id, ts);
    }
  }
}

export function calcDuration(start, end) {
  if (!start || !end) return null;
  const ms = new Date(end) - new Date(start);
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

export function formatToolSub(evt) {
  if (!evt.tool_input) return '';
  const ti = evt.tool_input;
  if (evt.tool_name === 'Bash') return (ti.command || '').slice(0, 45);
  if (evt.tool_name === 'Read') return (ti.file_path || '').split(/[/\\]/).pop();
  if (evt.tool_name === 'Write') return (ti.file_path || '').split(/[/\\]/).pop();
  if (evt.tool_name === 'Edit') return (ti.file_path || '').split(/[/\\]/).pop();
  if (evt.tool_name === 'Grep') return (ti.pattern || '').slice(0, 45);
  if (evt.tool_name === 'Glob') return (ti.pattern || '').slice(0, 45);
  if (evt.tool_name === 'Agent') return (ti.description || '').slice(0, 45);
  if (evt.tool_name === 'Skill') return (ti.skill || '').slice(0, 45);
  return '';
}

// ─── Layout (incremental orbital) ─────────────────────────────────────────
export const layoutDirtyRoots = new Set();
let _lastRootCount = -1;
let _layoutFullDirty = true;

function getRootId(n) {
  while (n && n.parentId) n = state.nodes.get(n.parentId);
  return n ? n.id : null;
}

export function markLayoutDirty(node) {
  const rid = getRootId(node);
  if (rid) layoutDirtyRoots.add(rid);
}

export function markLayoutFullDirty() { _layoutFullDirty = true; }

// Reset internal layout counters — called from clearState on session switch.
export function resetLayout() {
  _layoutFullDirty = true;
  _lastRootCount = -1;
  layoutDirtyRoots.clear();
}

// Count agent nodes in a subtree (the node + all transitively-reachable agent
// children). Used by the root layout to inflate the agent ring proportionally
// to how much room each branch needs.
function subtreeAgentCount(n) {
  let w = 1;
  for (const c of n.children) if (c.type === 'agent') w += subtreeAgentCount(c);
  return w;
}

// Position one agent's tool and sub-agent children outward from the agent
// (along `dirFromParent`), then recurse into each sub-agent. Sub-agents fan
// out on an outer arc; tools either fan along the parent axis (no sub-agents)
// or split into two short lateral fans (sub-agents present) so they avoid
// both the sub-agent ring and the path back to the parent.
function layoutAgent(agent, dirFromParent) {
  const filtered = agent.children.filter(c => matchesFilter(c));
  const subAgents = filtered.filter(c => c.type === 'agent');
  const tools = filtered.filter(c => c.type !== 'agent');

  const runningTools = tools.filter(c => c.status === 'running');
  const doneTools = tools.filter(c => c.status !== 'running');
  const visibleDone = doneTools.slice(-5);
  const visibleTools = [...visibleDone, ...runningTools];

  const subDist = 160 + Math.max(0, subAgents.length - 2) * 26;
  const subSpread = Math.min(Math.PI * 1.4, Math.max(Math.PI * 0.45, subAgents.length * 0.5));
  subAgents.forEach((sa, i) => {
    const t = subAgents.length === 1 ? 0 : (i / (subAgents.length - 1) - 0.5);
    const angle = dirFromParent + t * subSpread;
    sa.x = agent.x + Math.cos(angle) * subDist;
    sa.y = agent.y + Math.sin(angle) * subDist;
    layoutAgent(sa, angle);
  });

  if (subAgents.length === 0) {
    // No sub-agents → tools fan along the outward axis (legacy behaviour).
    const toolDist = 90 + visibleTools.length * 8;
    const toolSpread = Math.min(Math.PI * 1.2, visibleTools.length * 0.35);
    visibleTools.forEach((tool, ti) => {
      const tAngle = dirFromParent - toolSpread / 2
        + (ti / Math.max(visibleTools.length - 1, 1)) * toolSpread;
      tool.x = agent.x + Math.cos(tAngle) * toolDist;
      tool.y = agent.y + Math.sin(tAngle) * toolDist;
      tool._visible = true;
    });
  } else {
    // Sub-agents take the outward fan; place tools in two short side-fans
    // perpendicular to the parent axis so they avoid both the sub-agent ring
    // and the path back to the parent (which has its own tools).
    const half = Math.ceil(visibleTools.length / 2);
    const toolDist = 80 + half * 10;
    const fanSpread = Math.min(Math.PI * 0.6, Math.max(Math.PI * 0.2, half * 0.3));
    visibleTools.forEach((tool, ti) => {
      const onLeft = ti < half;
      const sideIdx = onLeft ? ti : ti - half;
      const sideCount = onLeft ? half : Math.max(1, visibleTools.length - half);
      const sideBase = dirFromParent + (onLeft ? -Math.PI / 2 : Math.PI / 2);
      const t = sideCount === 1 ? 0 : (sideIdx / (sideCount - 1) - 0.5);
      const angle = sideBase + t * fanSpread;
      tool.x = agent.x + Math.cos(angle) * toolDist;
      tool.y = agent.y + Math.sin(angle) * toolDist;
      tool._visible = true;
    });
  }
  tools.filter(c => !visibleTools.includes(c)).forEach(c => { c._visible = false; });
}

function layoutRoot(root) {
  const cx = root.x;
  const agents = root.children.filter(c => c.type === 'agent');
  const tools = root.children.filter(c => c.type !== 'agent');

  // Push agents farther out when any branch has its own sub-agents, so the
  // recursive sub-agent fans have room without colliding with the session ring.
  const branchInflation = agents.reduce((s, a) => s + Math.max(0, subtreeAgentCount(a) - 1), 0);
  const agentDist = SPAWN_DIST + Math.max(0, agents.length - 3) * 30 + branchInflation * 60;
  agents.forEach((agent, ai) => {
    const angle = -Math.PI / 2 + (ai / Math.max(agents.length, 1)) * Math.PI * 2;
    agent.x = cx + Math.cos(angle) * agentDist;
    agent.y = root.y + Math.sin(angle) * agentDist;
    layoutAgent(agent, angle);
  });

  const visibleRootTools = tools.filter(c => matchesFilter(c));
  const runningRootTools = visibleRootTools.filter(c => c.status === 'running');
  const doneRootTools = visibleRootTools.filter(c => c.status !== 'running');
  const recentRootTools = [...doneRootTools.slice(-10), ...runningRootTools];
  const rootToolDist = agents.length > 0 ? SPAWN_DIST * 0.55 : SPAWN_DIST * 0.7;
  recentRootTools.forEach((tool, ti) => {
    const angle = -Math.PI / 2 + (ti / Math.max(recentRootTools.length, 1)) * Math.PI * 2;
    tool.x = cx + Math.cos(angle) * rootToolDist;
    tool.y = root.y + Math.sin(angle) * rootToolDist;
    tool._visible = true;
  });
  visibleRootTools.filter(c => !recentRootTools.includes(c)).forEach(c => { c._visible = false; });
}

function pushTargetsForSubtree(root) {
  const stack = [root];
  while (stack.length) {
    const n = stack.pop();
    const vn = ensureVisNode(n.id);
    vn.targetX = n.x;
    vn.targetY = n.y;
    const isDoneTool = (n.type === 'tool' || n.type === 'skill' || n.type === 'mcp') && n.status !== 'running';
    vn.targetOpacity = (n._visible === false) ? 0 : isDoneTool ? 0.5 : 1;
    vn.targetScale = (n._visible === false) ? 0 : 1;
    if (n.children && n.children.length) {
      for (const c of n.children) stack.push(c);
    }
  }
}

export function layout() {
  const roots = [];
  for (const n of state.nodes.values()) {
    if (!n.parentId) roots.push(n);
  }
  const totalRoots = roots.length;

  if (totalRoots !== _lastRootCount || _layoutFullDirty) {
    _lastRootCount = totalRoots;
    _layoutFullDirty = false;
    layoutDirtyRoots.clear();
    roots.forEach((root, i) => {
      const cx = totalRoots > 1 ? (i - (totalRoots - 1) / 2) * 400 : 0;
      root.x = cx; root.y = 0;
      layoutRoot(root);
      pushTargetsForSubtree(root);
    });
    return;
  }

  if (!layoutDirtyRoots.size) return;

  roots.forEach((root, i) => {
    if (!layoutDirtyRoots.has(root.id)) return;
    const cx = totalRoots > 1 ? (i - (totalRoots - 1) / 2) * 400 : 0;
    root.x = cx; root.y = 0;
    layoutRoot(root);
    pushTargetsForSubtree(root);
  });
  layoutDirtyRoots.clear();
}

export function matchesFilter(n) {
  if (!state.filter) return true;
  const f = state.filter;
  return n.label.toLowerCase().includes(f) || n.sub.toLowerCase().includes(f) || n.type.includes(f);
}

// ─── Garbage collection ───────────────────────────────────────────────────
// Drop finished tool/skill/notification nodes older than the GC window, as
// long as no feed entry still references them (so clicks remain valid).
export function garbageCollect() {
  const now = Date.now();
  const referenced = new Set();
  for (const e of state.timelineEntries) referenced.add(e.nodeId);

  const victims = [];
  for (const n of state.nodes.values()) {
    if (n.type !== 'tool' && n.type !== 'skill' && n.type !== 'mcp' && n.type !== 'notification') continue;
    if (n.status === 'running') continue;
    if (!n.endTime) continue;
    const endMs = +new Date(n.endTime);
    if (!isFinite(endMs)) continue;
    if (now - endMs < NODE_GC_MAX_AGE_MS) continue;
    if (referenced.has(n.id)) continue;
    victims.push(n);
  }
  if (!victims.length) return;
  const victimIds = new Set(victims.map(v => v.id));
  for (const n of victims) {
    if (n.parentId) {
      const parent = state.nodes.get(n.parentId);
      if (parent) {
        const idx = parent.children.indexOf(n);
        if (idx >= 0) parent.children.splice(idx, 1);
      }
    }
    state.nodes.delete(n.id);
    vis.nodes.delete(n.id);
    vis.runningNodes.delete(n.id);
  }
  const purge = arr => {
    for (let i = arr.length - 1; i >= 0; i--) {
      if (victimIds.has(arr[i].n.id)) arr.splice(i, 1);
    }
  };
  purge(vis.drawToolNodes);
  purge(vis.drawSkillNodes);
  purge(vis.drawMcpNodes);
  purge(vis.drawAgentNodes);
  purge(vis.drawSessionNodes);
  markDirty();
}

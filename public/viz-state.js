// viz-state.js — constants, shared state, helpers, render scheduler.
//
// All mutable app state lives here (state, vis). Other modules import these
// live object references and mutate them directly. Primitive consts and
// stateless helpers are also exported.

// ─── Palette ──────────────────────────────────────────────────────────────
export const COLORS = {
  void: '#050510',
  grid: 'rgba(102, 204, 255, 0.03)',
  session: '#66ccff', agent: '#bc8cff', tool: '#ffbb44',
  skill: '#56d6e2', mcp: '#ff8cc8',
  error: '#ff5566', notification: '#ffaa33',
  complete: '#66ffaa', stop: '#8b949e',
  edge: 'rgba(102, 204, 255, 0.15)', edgeActive: 'rgba(102, 204, 255, 0.4)',
  particle: '#66ccff',
};

// ─── Geometry ─────────────────────────────────────────────────────────────
export const AGENT_R = 36;
export const SESSION_R = 44;
export const TOOL_W = 130, TOOL_H = 28;
export const SKILL_R = 22;
export const MCP_R = 24;
export const SPAWN_DIST = 220;
export const LERP_SPEED = 5;

// Feed buffer cap (timeline entries retained in memory).
export const TIMELINE_CAP = 500;
// GC window for finished tool/skill/notification nodes.
export const NODE_GC_MAX_AGE_MS = 10 * 60 * 1000;

// Lerp settling epsilons.
export const LERP_EPS_POS = 0.1;
export const LERP_EPS_OPACITY = 0.005;
export const LERP_EPS_SCALE = 0.005;
// Pulse-only animation throttle (running nodes glow at 20 fps).
export const PULSE_FRAME_MS = 1000 / 20;

// ─── App state ────────────────────────────────────────────────────────────
export const state = {
  eventSeq: 0, offset: 0, nodes: new Map(), selected: null,
  toolsCompleted: 0, filter: '', autoFit: true,
  timelineEntries: [], startTimes: new Map(),
  _lastServerId: null,
  // Token usage — populated by SSE `tokens` events. Shape:
  //   main: { in, out, cacheCreate, cacheRead } | null
  //   perAgent: Map<agentId, { in, out, cacheCreate, cacheRead }>
  tokens: { main: null, perAgent: new Map() },
};

// Visual/animation state.
export const vis = {
  nodes: new Map(),
  particles: [],
  camera: { x: 0, y: 0, zoom: 1, targetX: 0, targetY: 0, targetZoom: 1 },
  time: 0,
  hoveredNode: null,
  rafHandle: null,
  pulseTimer: null,
  dirty: true,
  activeAnimations: 0,
  drawSessionNodes: [],
  drawAgentNodes: [],
  drawToolNodes: [],
  drawSkillNodes: [],
  drawMcpNodes: [],
  runningNodes: new Set(),
  avgFrameMs: 8,
  _particleSkipToggle: false,
};

// ─── Render scheduler ─────────────────────────────────────────────────────
// The rAF driver lives in viz-canvas.js (tick). It registers itself here so
// markDirty/requestRender can schedule frames without a circular import.
let _tickFn = null;
export function setTickFn(fn) { _tickFn = fn; }

export function markDirty() {
  vis.dirty = true;
  requestRender();
}

export function requestRender() {
  if (vis.rafHandle != null || vis.pulseTimer != null) return;
  if (!_tickFn) return;
  vis.rafHandle = requestAnimationFrame(_tickFn);
}

// ─── Helpers ──────────────────────────────────────────────────────────────
const _haCache = new Map();
export function hexAlpha(hex, alpha) {
  if (hex.startsWith('rgba')) return hex;
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 100) / 100;
  const key = hex + a;
  let v = _haCache.get(key);
  if (!v) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    v = `rgba(${r},${g},${b},${a})`;
    _haCache.set(key, v);
  }
  return v;
}

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// Regular hexagon with a vertex pointing up, circumscribed radius r.
export function traceHexagon(ctx, cx, cy, r) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = -Math.PI / 2 + i * (Math.PI / 3);
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

// Diamond (losange) — square rotated 45°, half-diagonal r.
export function traceDiamond(ctx, cx, cy, r) {
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.lineTo(cx + r, cy);
  ctx.lineTo(cx, cy + r);
  ctx.lineTo(cx - r, cy);
  ctx.closePath();
}

// Parse an MCP tool name "mcp__<server>__<action>" into readable label/sub.
// Examples:
//   mcp__plugin_playwright_playwright__browser_click → {label:"browser_click", sub:"playwright"}
//   mcp__claude_ai_Gmail__authenticate              → {label:"authenticate", sub:"Gmail"}
export function parseMcpName(toolName) {
  if (!toolName || !toolName.startsWith('mcp__')) return { label: toolName || 'MCP', sub: '' };
  const parts = toolName.split('__');
  const action = parts[parts.length - 1] || toolName;
  // Middle segment holds the server id; drop common prefixes + dedup repeats.
  let server = parts.length >= 3 ? parts.slice(1, -1).join('_') : '';
  server = server.replace(/^plugin_/, '').replace(/^claude_ai_/, '');
  const segs = server.split('_').filter(Boolean);
  const dedup = [];
  for (const s of segs) if (dedup[dedup.length - 1] !== s) dedup.push(s);
  return { label: action, sub: dedup.join('_') };
}

export function truncate(s, max) { return s.length > max ? s.slice(0, max - 1) + '…' : s; }
export function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
export function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
export function lerp(a, b, t) { return a + (b - a) * t; }

// Compact token display — "850" / "12.4k" / "1.3M".
export function formatTokens(n) {
  if (!n || n < 1000) return String(n || 0);
  if (n < 10_000) return (n / 1000).toFixed(1) + 'k';
  if (n < 1_000_000) return Math.round(n / 1000) + 'k';
  return (n / 1_000_000).toFixed(1) + 'M';
}

// Sum of the 4 cumulative counters in a token bucket. Safe on null/undefined.
export function tokenTotal(t) {
  if (!t) return 0;
  return (t.in || 0) + (t.out || 0) + (t.cacheCreate || 0) + (t.cacheRead || 0);
}

// Context window size = last message's input + cache_creation + cache_read.
// Matches Claude Code's /context semantics (not cumulative).
export function tokenContext(t) {
  if (!t) return 0;
  return (t.lastIn || 0) + (t.lastCacheCreate || 0) + (t.lastCacheRead || 0);
}

// Extract the bare agent id from a node id of the form "a:<agentId>".
export function agentIdFromNode(nodeId) {
  return nodeId && nodeId.startsWith('a:') ? nodeId.slice(2) : null;
}

// Extract the bare session id from a node id of the form "s:<sid>".
export function sessionIdFromNode(nodeId) {
  return nodeId && nodeId.startsWith('s:') ? nodeId.slice(2) : null;
}

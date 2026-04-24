// viz-canvas.js — DOM canvas, camera, low-level drawing primitives, rAF loop.
//
// Owns the <canvas>, ctx, DPR-aware sizing, pan/zoom, particle/node drawers,
// and the main `tick` render driver. Other modules mutate `state`/`vis` and
// call `markDirty()` (viz-state) to trigger a redraw — they do not call into
// anything here directly except through `canvasSize` (live W/H bindings) and
// `setCanvasCallbacks` (UI wires showDetail/renderFeed for pointer clicks).

import {
  COLORS, AGENT_R, SESSION_R, TOOL_W, TOOL_H, SKILL_R, MCP_R,
  LERP_SPEED, LERP_EPS_POS, LERP_EPS_OPACITY, LERP_EPS_SCALE, PULSE_FRAME_MS,
  state, vis,
  markDirty, setTickFn,
  hexAlpha, roundRect, traceHexagon, traceDiamond, truncate, easeInOut, esc,
  formatTokens, tokenContext, agentIdFromNode,
} from './viz-state.js';

// Session node displays main-thread context window size (matches /context).
function sessionContextSize() {
  return tokenContext(state.tokens.main);
}

// ─── Canvas setup ─────────────────────────────────────────────────────────
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const tooltipEl = document.getElementById('node-tooltip');

// Update the hover tooltip. nodeId=null hides it. Positions the tooltip at
// the cursor with a small offset, flipping across the cursor if it would
// otherwise overflow the viewport.
function updateTooltip(clientX, clientY, nodeId) {
  if (!nodeId) { tooltipEl.classList.remove('visible'); return; }
  const n = state.nodes.get(nodeId);
  if (!n) { tooltipEl.classList.remove('visible'); return; }
  const typeColor = n.color || '#66ccff';
  const meta = [n.duration, n.status].filter(Boolean).join(' · ');
  tooltipEl.innerHTML = `
    <div class="nt-type" style="color:${typeColor}">${esc(n.type)}</div>
    <div class="nt-label">${esc(n.label || '')}</div>
    ${n.sub ? `<div class="nt-sub">${esc(n.sub)}</div>` : ''}
    ${meta ? `<div class="nt-meta">${esc(meta)}</div>` : ''}
  `;
  tooltipEl.classList.add('visible');
  // Measure after show, then position with viewport clamping.
  const tw = tooltipEl.offsetWidth, th = tooltipEl.offsetHeight;
  const vw = window.innerWidth, vh = window.innerHeight;
  let x = clientX + 14;
  let y = clientY + 16;
  if (x + tw > vw - 8) x = clientX - tw - 14;
  if (y + th > vh - 8) y = clientY - th - 16;
  tooltipEl.style.left = Math.max(4, x) + 'px';
  tooltipEl.style.top = Math.max(4, y) + 'px';
}

function hideTooltip() { tooltipEl.classList.remove('visible'); }

// Live-binding exports — importers read the current value after each resize.
export let W = 0, H = 0;

// Static background canvas (void + grid), invalidated on camera/resize.
const staticCanvas = document.createElement('canvas');
const staticCtx = staticCanvas.getContext('2d');
let _bgDirty = true;
function markBgDirty() { _bgDirty = true; }

function resize() {
  const main = document.getElementById('main');
  W = main.clientWidth; H = main.clientHeight;
  canvas.width = W * devicePixelRatio;
  canvas.height = H * devicePixelRatio;
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  staticCanvas.width = W * devicePixelRatio;
  staticCanvas.height = H * devicePixelRatio;
  staticCtx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  markBgDirty();
  markDirty();
}

// ─── Canvas → UI callbacks (wired by bootstrap/viz-ui) ────────────────────
let _onSelectNode = () => {};
let _onAfterSelect = () => {};
export function setCanvasCallbacks({ showDetail, renderFeed }) {
  _onSelectNode = showDetail || (() => {});
  _onAfterSelect = renderFeed || (() => {});
}

// ─── Camera (pan + zoom) ──────────────────────────────────────────────────
let dragging = false, dragStartX = 0, dragStartY = 0, camStartX = 0, camStartY = 0;

canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const r = e.deltaY > 0 ? 0.92 : 1.08;
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left, my = e.clientY - rect.top;
  const wc = screenToWorld(mx, my);
  vis.camera.targetZoom = Math.max(0.1, Math.min(5, vis.camera.targetZoom * r));
  vis.camera.targetX = mx / vis.camera.targetZoom - wc.x;
  vis.camera.targetY = my / vis.camera.targetZoom - wc.y;
  markDirty();
}, { passive: false });

canvas.addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
  const rect = canvas.getBoundingClientRect();
  const wc = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
  const hit = hitTest(wc.x, wc.y);
  if (hit) {
    state.selected = hit.id;
    const n = state.nodes.get(hit.id);
    if (n) _onSelectNode(n);
    _onAfterSelect();
    markDirty();
    return;
  }
  dragging = true;
  dragStartX = e.clientX; dragStartY = e.clientY;
  camStartX = vis.camera.targetX; camStartY = vis.camera.targetY;
  canvas.style.cursor = 'grabbing';
  canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener('pointermove', e => {
  if (dragging) {
    const dx = (e.clientX - dragStartX) / vis.camera.zoom;
    const dy = (e.clientY - dragStartY) / vis.camera.zoom;
    vis.camera.targetX = camStartX + dx;
    vis.camera.targetY = camStartY + dy;
    markDirty();
    hideTooltip();
  } else {
    const rect = canvas.getBoundingClientRect();
    const wc = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
    const hit = hitTest(wc.x, wc.y);
    const prev = vis.hoveredNode;
    vis.hoveredNode = hit ? hit.id : null;
    canvas.style.cursor = hit ? 'pointer' : 'grab';
    if (prev !== vis.hoveredNode) markDirty();
    updateTooltip(e.clientX, e.clientY, vis.hoveredNode);
  }
});

canvas.addEventListener('pointerup', () => {
  dragging = false;
  canvas.style.cursor = 'grab';
});

canvas.addEventListener('pointerleave', () => {
  vis.hoveredNode = null;
  hideTooltip();
  markDirty();
});

function screenToWorld(sx, sy) {
  return { x: sx / vis.camera.zoom - vis.camera.x, y: sy / vis.camera.zoom - vis.camera.y };
}

function hitTest(wx, wy) {
  const entries = [...vis.nodes.entries()].reverse();
  for (const [id, vn] of entries) {
    const n = state.nodes.get(id);
    if (!n) continue;
    if (n.type === 'session' || n.type === 'agent') {
      const r = n.type === 'session' ? SESSION_R : AGENT_R;
      const dist = Math.hypot(wx - vn.x, wy - vn.y);
      if (dist <= r * vn.scale) return { id };
    } else if (n.type === 'skill') {
      const dist = Math.hypot(wx - vn.x, wy - vn.y);
      if (dist <= SKILL_R * vn.scale) return { id };
    } else if (n.type === 'mcp') {
      // Diamond hit test: |dx| + |dy| <= r (Manhattan distance).
      const r = MCP_R * vn.scale;
      if (Math.abs(wx - vn.x) + Math.abs(wy - vn.y) <= r) return { id };
    } else {
      const hw = TOOL_W / 2, hh = TOOL_H / 2;
      if (wx >= vn.x - hw && wx <= vn.x + hw && wy >= vn.y - hh && wy <= vn.y + hh) return { id };
    }
  }
  return null;
}

// ─── Glow sprites ─────────────────────────────────────────────────────────
const GLOW_SPRITE_SIZE = 128;
const _glowSprites = new Map();
function getGlowSprite(color) {
  let cv = _glowSprites.get(color);
  if (cv) return cv;
  cv = document.createElement('canvas');
  cv.width = GLOW_SPRITE_SIZE; cv.height = GLOW_SPRITE_SIZE;
  const gctx = cv.getContext('2d');
  const cx = GLOW_SPRITE_SIZE / 2, cy = GLOW_SPRITE_SIZE / 2;
  const grad = gctx.createRadialGradient(cx, cy, 0, cx, cy, GLOW_SPRITE_SIZE / 2);
  grad.addColorStop(0, hexAlpha(color, 1));
  grad.addColorStop(1, hexAlpha(color, 0));
  gctx.fillStyle = grad;
  gctx.fillRect(0, 0, GLOW_SPRITE_SIZE, GLOW_SPRITE_SIZE);
  _glowSprites.set(color, cv);
  return cv;
}

function drawGlowSprite(color, cx, cy, r, alpha) {
  const sprite = getGlowSprite(color);
  const size = r * 2;
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  ctx.drawImage(sprite, cx - r, cy - r, size, size);
  ctx.restore();
}

// ─── Grid pattern (cached, zoom-snapped) ──────────────────────────────────
const _gridTile = document.createElement('canvas');
const _gridCtx = _gridTile.getContext('2d');
let _gridPattern = null;
let _gridZoomSnap = -1;

function ensureGridPattern() {
  const gridSize = 40;
  const snap = Math.round(vis.camera.zoom * 20) / 20;
  if (snap === _gridZoomSnap && _gridPattern) return;
  _gridZoomSnap = snap;
  const step = Math.max(4, Math.round(gridSize * snap));
  _gridTile.width = step;
  _gridTile.height = step;
  _gridCtx.clearRect(0, 0, step, step);
  _gridCtx.fillStyle = COLORS.grid;
  _gridCtx.beginPath();
  _gridCtx.arc(0, 0, 0.8, 0, Math.PI * 2);
  _gridCtx.fill();
  _gridPattern = ctx.createPattern(_gridTile, 'repeat');
}

function drawGrid(targetCtx) {
  ensureGridPattern();
  if (!_gridPattern) return;
  const c = targetCtx || ctx;
  const cam = vis.camera;
  const gridSize = 40;
  const ox = (cam.x * cam.zoom) % (gridSize * cam.zoom);
  const oy = (cam.y * cam.zoom) % (gridSize * cam.zoom);
  c.save();
  c.translate(ox, oy);
  c.fillStyle = _gridPattern;
  c.fillRect(-gridSize * cam.zoom, -gridSize * cam.zoom, W + gridSize * cam.zoom * 2, H + gridSize * cam.zoom * 2);
  c.restore();
}

// ─── Node/edge drawers ────────────────────────────────────────────────────
function drawEdge(from, to, active) {
  const alpha = Math.min(from.opacity, to.opacity);
  if (alpha < 0.05) return;
  ctx.beginPath();
  const mx = (from.x + to.x) / 2;
  const my = (from.y + to.y) / 2;
  ctx.moveTo(from.x, from.y);
  ctx.quadraticCurveTo(mx + (to.y - from.y) * 0.15, my - (to.x - from.x) * 0.15, to.x, to.y);
  if (active) {
    ctx.strokeStyle = hexAlpha(COLORS.edgeActive, alpha);
    ctx.lineWidth = 2;
    ctx.setLineDash([]);
    ctx.stroke();
    ctx.strokeStyle = hexAlpha('#66ccff', alpha * 0.15);
    ctx.lineWidth = 8;
    ctx.stroke();
  } else {
    ctx.strokeStyle = hexAlpha(COLORS.edge, alpha * 0.6);
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.stroke();
  }
}

function drawSessionNode(n, vn) {
  const r = SESSION_R * vn.scale;
  const isSelected = state.selected === n.id;
  const isHovered = vis.hoveredNode === n.id;
  const pulse = n.status === 'running' ? 0.5 + 0.5 * Math.sin(vis.time * 2 + vn.glowPhase) : 0;

  ctx.save();
  ctx.globalAlpha = vn.opacity;

  if (n.status === 'running' || isSelected) {
    drawGlowSprite(n.color, vn.x, vn.y, r * 2.5, (0.15 + pulse * 0.1) * vn.opacity);
  }

  ctx.beginPath();
  ctx.arc(vn.x, vn.y, r, 0, Math.PI * 2);
  ctx.strokeStyle = hexAlpha(n.color, 0.4 + pulse * 0.3 + (isHovered ? 0.2 : 0));
  ctx.lineWidth = isSelected ? 3 : 2;
  ctx.stroke();

  ctx.fillStyle = hexAlpha(n.color, 0.08 + (isHovered ? 0.04 : 0));
  ctx.fill();

  ctx.beginPath();
  ctx.arc(vn.x, vn.y, r * 0.6, 0, Math.PI * 2);
  ctx.strokeStyle = hexAlpha(n.color, 0.15);
  ctx.lineWidth = 1;
  ctx.stroke();

  if (n.status === 'running') {
    ctx.beginPath();
    const startAngle = vis.time * 1.5;
    ctx.arc(vn.x, vn.y, r + 4, startAngle, startAngle + Math.PI * 0.7);
    ctx.strokeStyle = hexAlpha(n.color, 0.6);
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  ctx.fillStyle = hexAlpha('#ffffff', 0.9);
  ctx.font = 'bold 13px -apple-system, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(n.label, vn.x, vn.y - 6);

  ctx.fillStyle = hexAlpha(n.color, 0.7);
  ctx.font = '10px -apple-system, system-ui, sans-serif';
  ctx.fillText(n.sub, vn.x, vn.y + 9);

  if (n.duration) {
    ctx.fillStyle = hexAlpha('#ffffff', 0.4);
    ctx.font = '9px -apple-system, system-ui, sans-serif';
    ctx.fillText(n.duration, vn.x, vn.y + r + 14);
  }

  const sessionCtx = sessionContextSize();
  if (sessionCtx > 0) {
    ctx.fillStyle = hexAlpha(n.color, 0.55);
    ctx.font = '9px -apple-system, system-ui, sans-serif';
    ctx.fillText(`${formatTokens(sessionCtx)} ctx`, vn.x, vn.y + r + (n.duration ? 26 : 14));
  }

  ctx.restore();
}

// Overlay markers for agent flags — dashed ring when isolated (worktree),
// concentric ring when running as part of a parallel batch. Kept out of
// drawAgentNode so the base renderer stays untouched by this concern.
function drawAgentDecorations(n, vn, r) {
  if (n.isParallel) {
    ctx.save();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(vn.x, vn.y, r + 3, 0, Math.PI * 2);
    ctx.strokeStyle = hexAlpha(n.color, 0.45);
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }
  if (n.isIsolated) {
    ctx.save();
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.arc(vn.x, vn.y, r + 7, 0, Math.PI * 2);
    ctx.strokeStyle = hexAlpha(n.color, 0.7);
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }
}

function drawAgentNode(n, vn) {
  const r = AGENT_R * vn.scale;
  const isSelected = state.selected === n.id;
  const isHovered = vis.hoveredNode === n.id;
  const pulse = n.status === 'running' ? 0.5 + 0.5 * Math.sin(vis.time * 2.5 + vn.glowPhase) : 0;

  ctx.save();
  ctx.globalAlpha = vn.opacity;

  if (n.status === 'running' || isSelected) {
    drawGlowSprite(n.color, vn.x, vn.y, r * 2, (0.12 + pulse * 0.08) * vn.opacity);
  }

  ctx.beginPath();
  ctx.arc(vn.x, vn.y, r, 0, Math.PI * 2);
  ctx.fillStyle = hexAlpha(n.color, 0.08 + (isHovered ? 0.05 : 0));
  ctx.fill();
  ctx.strokeStyle = hexAlpha(n.color, 0.5 + pulse * 0.3 + (isHovered ? 0.2 : 0));
  ctx.lineWidth = isSelected ? 2.5 : 1.5;
  ctx.stroke();

  drawAgentDecorations(n, vn, r);

  if (n.status === 'running') {
    ctx.beginPath();
    const a = vis.time * 2;
    ctx.arc(vn.x, vn.y, r + 3, a, a + Math.PI * 0.5);
    ctx.strokeStyle = hexAlpha(n.color, 0.5);
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  ctx.fillStyle = hexAlpha('#ffffff', 0.9);
  ctx.font = 'bold 11px -apple-system, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(truncate(n.label, 14), vn.x, vn.y - 5);

  ctx.fillStyle = hexAlpha(n.color, 0.6);
  ctx.font = '9px -apple-system, system-ui, sans-serif';
  ctx.fillText(truncate(n.sub, 18), vn.x, vn.y + 8);

  const toolCount = n.children.length;
  if (toolCount > 0) {
    const runCount = n.children.filter(c => c.status === 'running').length;
    const badgeText = runCount > 0 ? `${runCount}/${toolCount}` : String(toolCount);
    ctx.font = '9px -apple-system, system-ui, sans-serif';
    const tw = ctx.measureText(badgeText).width + 8;
    const bx = vn.x + r * 0.7, by = vn.y - r * 0.7;
    ctx.fillStyle = hexAlpha(n.color, 0.3);
    roundRect(ctx, bx - tw / 2, by - 7, tw, 14, 7);
    ctx.fill();
    ctx.fillStyle = hexAlpha('#ffffff', 0.8);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(badgeText, bx, by);
  }

  if (n.duration) {
    ctx.fillStyle = hexAlpha('#ffffff', 0.35);
    ctx.font = '9px -apple-system, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(n.duration, vn.x, vn.y + r + 12);
  }

  const aid = agentIdFromNode(n.id);
  const agentBucket = aid ? state.tokens.perAgent.get(aid) : null;
  const agentCtx = tokenContext(agentBucket);
  if (agentCtx > 0) {
    ctx.fillStyle = hexAlpha(n.color, 0.55);
    ctx.font = '9px -apple-system, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${formatTokens(agentCtx)} ctx`, vn.x, vn.y + r + (n.duration ? 24 : 12));
  }

  ctx.restore();
}

function drawToolNode(n, vn) {
  const w = TOOL_W * vn.scale;
  const h = TOOL_H * vn.scale;
  const isSelected = state.selected === n.id;
  const isHovered = vis.hoveredNode === n.id;
  const isRunning = n.status === 'running';
  const isError = n.status === 'error';

  ctx.save();
  ctx.globalAlpha = vn.opacity;

  const color = isError ? COLORS.error : n.color;

  if (isRunning) {
    drawGlowSprite(color, vn.x, vn.y, w * 0.8, 0.06 * vn.opacity);
  }

  ctx.fillStyle = hexAlpha(color, isHovered ? 0.12 : 0.06);
  roundRect(ctx, vn.x - w / 2, vn.y - h / 2, w, h, 8 * vn.scale);
  ctx.fill();

  ctx.strokeStyle = hexAlpha(color, isSelected ? 0.6 : isHovered ? 0.4 : 0.2);
  ctx.lineWidth = isSelected ? 2 : 1;
  roundRect(ctx, vn.x - w / 2, vn.y - h / 2, w, h, 8 * vn.scale);
  ctx.stroke();

  const dotR = 3 * vn.scale;
  const dotX = vn.x - w / 2 + 10 * vn.scale;
  const dotColor = isError ? COLORS.error : isRunning ? COLORS.notification : COLORS.complete;
  ctx.beginPath();
  ctx.arc(dotX, vn.y, dotR, 0, Math.PI * 2);
  ctx.fillStyle = dotColor;
  ctx.fill();
  if (isRunning) {
    ctx.beginPath();
    ctx.arc(dotX, vn.y, dotR * 2.5, 0, Math.PI * 2);
    ctx.fillStyle = hexAlpha(dotColor, 0.15 + 0.1 * Math.sin(vis.time * 3));
    ctx.fill();
  }

  ctx.fillStyle = hexAlpha('#ffffff', 0.85);
  ctx.font = `bold ${10 * vn.scale}px -apple-system, system-ui, sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(truncate(n.label, 12), vn.x - w / 2 + 20 * vn.scale, vn.y - (n.sub ? 4 : 0) * vn.scale);

  if (n.sub) {
    ctx.fillStyle = hexAlpha(color, 0.5);
    ctx.font = `${8 * vn.scale}px -apple-system, system-ui, sans-serif`;
    ctx.fillText(truncate(n.sub, 20), vn.x - w / 2 + 20 * vn.scale, vn.y + 7 * vn.scale);
  }

  if (n.duration) {
    ctx.fillStyle = hexAlpha('#ffffff', 0.35);
    ctx.font = `${8 * vn.scale}px -apple-system, system-ui, sans-serif`;
    ctx.textAlign = 'right';
    ctx.fillText(n.duration, vn.x + w / 2 - 8 * vn.scale, vn.y);
  }

  ctx.restore();
}

function drawMcpNode(n, vn) {
  const r = MCP_R * vn.scale;
  const isSelected = state.selected === n.id;
  const isHovered = vis.hoveredNode === n.id;
  const isRunning = n.status === 'running';
  const isError = n.status === 'error';
  const color = isError ? COLORS.error : n.color;

  ctx.save();
  ctx.globalAlpha = vn.opacity;

  if (isRunning) {
    drawGlowSprite(color, vn.x, vn.y, r * 2.2, 0.09 * vn.opacity);
  }

  traceDiamond(ctx, vn.x, vn.y, r);
  ctx.fillStyle = hexAlpha(color, isHovered ? 0.14 : 0.08);
  ctx.fill();
  ctx.strokeStyle = hexAlpha(color, isSelected ? 0.7 : isHovered ? 0.5 : 0.3);
  ctx.lineWidth = isSelected ? 2 : 1.2;
  ctx.stroke();

  const dotR = 2.5 * vn.scale;
  const dotY = vn.y - r * 0.58;
  const dotColor = isError ? COLORS.error : isRunning ? COLORS.notification : COLORS.complete;
  ctx.beginPath();
  ctx.arc(vn.x, dotY, dotR, 0, Math.PI * 2);
  ctx.fillStyle = dotColor;
  ctx.fill();
  if (isRunning) {
    ctx.beginPath();
    ctx.arc(vn.x, dotY, dotR * 2.5, 0, Math.PI * 2);
    ctx.fillStyle = hexAlpha(dotColor, 0.15 + 0.1 * Math.sin(vis.time * 3));
    ctx.fill();
  }

  ctx.fillStyle = hexAlpha('#ffffff', 0.9);
  ctx.font = `bold ${9 * vn.scale}px -apple-system, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(truncate(n.label, 12), vn.x, vn.y - (n.sub ? 3 : 0) * vn.scale);

  if (n.sub) {
    ctx.fillStyle = hexAlpha(color, 0.55);
    ctx.font = `${7 * vn.scale}px -apple-system, system-ui, sans-serif`;
    ctx.fillText(truncate(n.sub, 14), vn.x, vn.y + 7 * vn.scale);
  }

  if (n.duration) {
    ctx.fillStyle = hexAlpha('#ffffff', 0.4);
    ctx.font = `${8 * vn.scale}px -apple-system, system-ui, sans-serif`;
    ctx.fillText(n.duration, vn.x, vn.y + r + 9);
  }

  ctx.restore();
}

function drawSkillNode(n, vn) {
  const r = SKILL_R * vn.scale;
  const isSelected = state.selected === n.id;
  const isHovered = vis.hoveredNode === n.id;
  const isRunning = n.status === 'running';
  const isError = n.status === 'error';
  const color = isError ? COLORS.error : n.color;

  ctx.save();
  ctx.globalAlpha = vn.opacity;

  if (isRunning) {
    drawGlowSprite(color, vn.x, vn.y, r * 2.2, 0.08 * vn.opacity);
  }

  traceHexagon(ctx, vn.x, vn.y, r);
  ctx.fillStyle = hexAlpha(color, isHovered ? 0.14 : 0.08);
  ctx.fill();
  ctx.strokeStyle = hexAlpha(color, isSelected ? 0.7 : isHovered ? 0.5 : 0.3);
  ctx.lineWidth = isSelected ? 2 : 1.2;
  ctx.stroke();

  const dotR = 2.5 * vn.scale;
  const dotY = vn.y - r * 0.55;
  const dotColor = isError ? COLORS.error : isRunning ? COLORS.notification : COLORS.complete;
  ctx.beginPath();
  ctx.arc(vn.x, dotY, dotR, 0, Math.PI * 2);
  ctx.fillStyle = dotColor;
  ctx.fill();
  if (isRunning) {
    ctx.beginPath();
    ctx.arc(vn.x, dotY, dotR * 2.5, 0, Math.PI * 2);
    ctx.fillStyle = hexAlpha(dotColor, 0.15 + 0.1 * Math.sin(vis.time * 3));
    ctx.fill();
  }

  ctx.fillStyle = hexAlpha('#ffffff', 0.9);
  ctx.font = `bold ${10 * vn.scale}px -apple-system, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(truncate(n.label, 10), vn.x, vn.y + 2 * vn.scale);

  if (n.duration) {
    ctx.fillStyle = hexAlpha('#ffffff', 0.4);
    ctx.font = `${8 * vn.scale}px -apple-system, system-ui, sans-serif`;
    ctx.fillText(n.duration, vn.x, vn.y + r + 9);
  }

  ctx.restore();
}

function drawEmptyState() {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const pulse = 0.3 + 0.1 * Math.sin(vis.time * 1.5);
  ctx.fillStyle = hexAlpha('#66ccff', pulse);
  ctx.font = 'bold 48px -apple-system, system-ui, sans-serif';
  ctx.fillText('◈', W / 2 - 180, H / 2);

  for (let i = 0; i < 3; i++) {
    const r = 60 + i * 25;
    const alpha = 0.08 - i * 0.02 + 0.03 * Math.sin(vis.time * 1.2 + i);
    ctx.beginPath();
    ctx.arc(W / 2 - 180, H / 2, r, 0, Math.PI * 2);
    ctx.strokeStyle = hexAlpha('#66ccff', alpha);
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  ctx.fillStyle = hexAlpha('#66ccff', 0.5);
  ctx.font = '14px -apple-system, system-ui, sans-serif';
  ctx.fillText('Waiting for Claude Code events...', W / 2 - 180, H / 2 + 90);

  ctx.fillStyle = hexAlpha('#66ccff', 0.25);
  ctx.font = '12px -apple-system, system-ui, sans-serif';
  ctx.fillText('Events will appear here in real-time', W / 2 - 180, H / 2 + 112);

  ctx.restore();
}

// ─── Particles ────────────────────────────────────────────────────────────
const PARTICLE_CAP = 80;

function updateParticles(dt) {
  const heavy = vis.avgFrameMs > 25;
  if (heavy) {
    vis._particleSkipToggle = !vis._particleSkipToggle;
    if (vis._particleSkipToggle) return;
  }

  for (const id of vis.runningNodes) {
    const n = state.nodes.get(id);
    if (!n || !n.parentId) continue;
    const pvn = vis.nodes.get(n.parentId);
    const vn = vis.nodes.get(id);
    if (!pvn || !vn || vn.opacity < 0.1) continue;

    if (Math.random() < dt * 3) {
      vis.particles.push({
        sx: pvn.x, sy: pvn.y,
        tx: vn.x, ty: vn.y,
        progress: 0, speed: 0.3 + Math.random() * 0.5,
        size: 1.2 + Math.random() * 1.5,
        color: n.color || COLORS.particle,
        opacity: 1,
      });
    }
  }

  for (let i = vis.particles.length - 1; i >= 0; i--) {
    const p = vis.particles[i];
    p.progress += dt * p.speed;
    if (p.progress >= 1) { vis.particles.splice(i, 1); continue; }
    const t = easeInOut(p.progress);
    p.x = p.sx + (p.tx - p.sx) * t;
    p.y = p.sy + (p.ty - p.sy) * t;
    p.opacity = p.progress < 0.15 ? p.progress / 0.15 : p.progress > 0.75 ? (1 - p.progress) / 0.25 : 1;
  }

  if (vis.particles.length > PARTICLE_CAP) vis.particles.splice(0, vis.particles.length - PARTICLE_CAP);
}

function drawParticlesBatched(vw) {
  if (!vis.particles.length) return;
  const byColor = new Map();
  for (const p of vis.particles) {
    if (p.opacity <= 0) continue;
    if (p.x < vw.minX || p.x > vw.maxX || p.y < vw.minY || p.y > vw.maxY) continue;
    let arr = byColor.get(p.color);
    if (!arr) { arr = []; byColor.set(p.color, arr); }
    arr.push(p);
  }
  for (const [color, arr] of byColor) {
    ctx.beginPath();
    for (const p of arr) {
      ctx.moveTo(p.x + p.size, p.y);
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    }
    ctx.fillStyle = hexAlpha(color, 0.55);
    ctx.fill();

    ctx.beginPath();
    for (const p of arr) {
      const r = p.size * 3;
      ctx.moveTo(p.x + r, p.y);
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    }
    ctx.fillStyle = hexAlpha(color, 0.1);
    ctx.fill();
  }
}

// ─── Render loop ──────────────────────────────────────────────────────────
let lastFrame = 0;

function hasRunningNode() {
  for (const n of state.nodes.values()) {
    if (n.status === 'running') return true;
  }
  return false;
}

function countMovingNodes() {
  let moving = 0;
  for (const vn of vis.nodes.values()) {
    if (Math.abs(vn.x - vn.targetX) > LERP_EPS_POS
      || Math.abs(vn.y - vn.targetY) > LERP_EPS_POS
      || Math.abs(vn.opacity - vn.targetOpacity) > LERP_EPS_OPACITY
      || Math.abs(vn.scale - vn.targetScale) > LERP_EPS_SCALE) moving++;
  }
  return moving;
}

function isCameraMoving() {
  const cam = vis.camera;
  return Math.abs(cam.x - cam.targetX) > LERP_EPS_POS
    || Math.abs(cam.y - cam.targetY) > LERP_EPS_POS
    || Math.abs(cam.zoom - cam.targetZoom) > 0.002;
}

function tick(now) {
  vis.rafHandle = null;
  vis.pulseTimer = null;
  if (!lastFrame) lastFrame = now;
  const dt = Math.min((now - lastFrame) / 1000, 0.05);
  lastFrame = now;
  vis.time = now / 1000;

  const cam = vis.camera;
  cam.x += (cam.targetX - cam.x) * Math.min(1, dt * 8);
  cam.y += (cam.targetY - cam.y) * Math.min(1, dt * 8);
  cam.zoom += (cam.targetZoom - cam.zoom) * Math.min(1, dt * 8);

  for (const vn of vis.nodes.values()) {
    const lerpAmt = Math.min(1, dt * LERP_SPEED);
    vn.x += (vn.targetX - vn.x) * lerpAmt;
    vn.y += (vn.targetY - vn.y) * lerpAmt;
    vn.opacity += (vn.targetOpacity - vn.opacity) * lerpAmt;
    vn.scale += (vn.targetScale - vn.scale) * lerpAmt;
    if (Math.abs(vn.x - vn.targetX) < LERP_EPS_POS) vn.x = vn.targetX;
    if (Math.abs(vn.y - vn.targetY) < LERP_EPS_POS) vn.y = vn.targetY;
    if (Math.abs(vn.opacity - vn.targetOpacity) < LERP_EPS_OPACITY) vn.opacity = vn.targetOpacity;
    if (Math.abs(vn.scale - vn.targetScale) < LERP_EPS_SCALE) vn.scale = vn.targetScale;
  }

  updateParticles(dt);

  const t0 = performance.now();
  draw();
  const frameMs = performance.now() - t0;
  vis.avgFrameMs = vis.avgFrameMs * 0.9 + frameMs * 0.1;
  vis.dirty = false;

  const moving = countMovingNodes() + (isCameraMoving() ? 1 : 0);
  vis.activeAnimations = moving;
  const needsFull = vis.dirty || moving > 0 || vis.particles.length > 0;
  if (needsFull) {
    vis.rafHandle = requestAnimationFrame(tick);
  } else if (hasRunningNode() || state.nodes.size === 0) {
    const finishedMs = performance.now() - now;
    const delay = Math.max(0, PULSE_FRAME_MS - finishedMs);
    vis.pulseTimer = setTimeout(() => {
      vis.pulseTimer = null;
      vis.rafHandle = requestAnimationFrame(tick);
    }, delay);
  }
}

function getWorldBounds() {
  const cam = vis.camera;
  const padWorld = 120 / Math.max(0.001, cam.zoom);
  const tl = screenToWorld(0, 0);
  const br = screenToWorld(W, H);
  return {
    minX: tl.x - padWorld, minY: tl.y - padWorld,
    maxX: br.x + padWorld, maxY: br.y + padWorld,
  };
}

function inBounds(vn, vw) {
  return vn.x >= vw.minX && vn.x <= vw.maxX && vn.y >= vw.minY && vn.y <= vw.maxY;
}

let _bgCamX = NaN, _bgCamY = NaN, _bgCamZoom = NaN;

function paintStaticBg() {
  const cam = vis.camera;
  if (!_bgDirty && cam.x === _bgCamX && cam.y === _bgCamY && cam.zoom === _bgCamZoom) return;
  _bgDirty = false;
  _bgCamX = cam.x; _bgCamY = cam.y; _bgCamZoom = cam.zoom;
  staticCtx.clearRect(0, 0, W, H);
  staticCtx.fillStyle = COLORS.void;
  staticCtx.fillRect(0, 0, W, H);
  drawGrid(staticCtx);
}

function draw() {
  const cam = vis.camera;
  if (cam.x !== _bgCamX || cam.y !== _bgCamY || cam.zoom !== _bgCamZoom) markBgDirty();
  paintStaticBg();

  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(staticCanvas, 0, 0, W, H);

  ctx.save();
  ctx.translate(cam.x * cam.zoom, cam.y * cam.zoom);
  ctx.scale(cam.zoom, cam.zoom);

  const vw = getWorldBounds();

  for (const n of state.nodes.values()) {
    if (!n.parentId) continue;
    const vn = vis.nodes.get(n.id);
    const pvn = vis.nodes.get(n.parentId);
    if (!vn || !pvn || vn.opacity < 0.05) continue;
    if (!inBounds(vn, vw) && !inBounds(pvn, vw)) continue;
    drawEdge(pvn, vn, n.status === 'running');
  }

  drawParticlesBatched(vw);

  for (const { n, vn } of vis.drawSessionNodes) {
    if (vn.opacity < 0.05 || !inBounds(vn, vw)) continue;
    drawSessionNode(n, vn);
  }
  for (const { n, vn } of vis.drawAgentNodes) {
    if (vn.opacity < 0.05 || !inBounds(vn, vw)) continue;
    drawAgentNode(n, vn);
  }
  for (const { n, vn } of vis.drawToolNodes) {
    if (vn.opacity < 0.05 || !inBounds(vn, vw)) continue;
    drawToolNode(n, vn);
  }
  for (const { n, vn } of vis.drawSkillNodes) {
    if (vn.opacity < 0.05 || !inBounds(vn, vw)) continue;
    drawSkillNode(n, vn);
  }
  for (const { n, vn } of vis.drawMcpNodes) {
    if (vn.opacity < 0.05 || !inBounds(vn, vw)) continue;
    drawMcpNode(n, vn);
  }

  ctx.restore();

  if (state.nodes.size === 0) {
    drawEmptyState();
  }
}

// ─── Module init ──────────────────────────────────────────────────────────
// Register tick with viz-state so markDirty/requestRender can schedule it.
setTickFn(tick);
resize();
window.addEventListener('resize', resize);

// viz-drawers.js — pure node drawers + glow sprite cache.
//
// Each drawXxxNode(ctx, n, vn) renders a single node onto the supplied 2D
// context. Drawers are pure-ish: they read state/vis (selection, hover,
// running flag, time) and write only to ctx — no DOM, no rAF, no camera.
// They accept the canvas context as a parameter so they can be unit-tested
// against an offscreen canvas without touching the live render loop.
//
// drawGlowSprite (and its sprite cache) lives here because it's only used by
// the drawers — moving it out of viz-canvas keeps that file focused on the
// canvas/camera/loop responsibilities.

import {
  COLORS, AGENT_R, SESSION_R, TOOL_W, TOOL_H, SKILL_R, MCP_R,
  state, vis,
  hexAlpha, roundRect, traceHexagon, traceDiamond, truncate, esc,
  formatTokens, tokenContext, agentIdFromNode,
} from './viz-state.js';

// ─── Glow sprites (pre-rendered radial gradients, cached per color) ───────
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

function drawGlowSprite(ctx, color, cx, cy, r, alpha) {
  const sprite = getGlowSprite(color);
  const size = r * 2;
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  ctx.drawImage(sprite, cx - r, cy - r, size, size);
  ctx.restore();
}

// ─── Drawers ──────────────────────────────────────────────────────────────
// Session node displays main-thread context window size (matches /context).
function sessionContextSize() {
  return tokenContext(state.tokens.main);
}

export function drawSessionNode(ctx, n, vn) {
  const r = SESSION_R * vn.scale;
  const isSelected = state.selected === n.id;
  const isHovered = vis.hoveredNode === n.id;
  const pulse = n.status === 'running' ? 0.5 + 0.5 * Math.sin(vis.time * 2 + vn.glowPhase) : 0;

  ctx.save();
  ctx.globalAlpha = vn.opacity;

  if (n.status === 'running' || isSelected) {
    drawGlowSprite(ctx, n.color, vn.x, vn.y, r * 2.5, (0.15 + pulse * 0.1) * vn.opacity);
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
  if (sessionCtx > 0 && state.tokens.tokensSupported !== false) {
    ctx.fillStyle = hexAlpha(n.color, 0.55);
    ctx.font = '9px -apple-system, system-ui, sans-serif';
    ctx.fillText(`${formatTokens(sessionCtx)} ctx`, vn.x, vn.y + r + (n.duration ? 26 : 14));
  }

  ctx.restore();
}

// Overlay markers for agent flags — dashed ring when isolated (worktree),
// concentric ring when running as part of a parallel batch. Kept out of
// drawAgentNode so the base renderer stays untouched by this concern.
function drawAgentDecorations(ctx, n, vn, r) {
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

export function drawAgentNode(ctx, n, vn) {
  const r = AGENT_R * vn.scale;
  const isSelected = state.selected === n.id;
  const isHovered = vis.hoveredNode === n.id;
  const pulse = n.status === 'running' ? 0.5 + 0.5 * Math.sin(vis.time * 2.5 + vn.glowPhase) : 0;

  ctx.save();
  ctx.globalAlpha = vn.opacity;

  if (n.status === 'running' || isSelected) {
    drawGlowSprite(ctx, n.color, vn.x, vn.y, r * 2, (0.12 + pulse * 0.08) * vn.opacity);
  }

  ctx.beginPath();
  ctx.arc(vn.x, vn.y, r, 0, Math.PI * 2);
  ctx.fillStyle = hexAlpha(n.color, 0.08 + (isHovered ? 0.05 : 0));
  ctx.fill();
  ctx.strokeStyle = hexAlpha(n.color, 0.5 + pulse * 0.3 + (isHovered ? 0.2 : 0));
  ctx.lineWidth = isSelected ? 2.5 : 1.5;
  ctx.stroke();

  drawAgentDecorations(ctx, n, vn, r);

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
  if (agentCtx > 0 && state.tokens.tokensSupported !== false) {
    ctx.fillStyle = hexAlpha(n.color, 0.55);
    ctx.font = '9px -apple-system, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${formatTokens(agentCtx)} ctx`, vn.x, vn.y + r + (n.duration ? 24 : 12));
  }

  ctx.restore();
}

export function drawToolNode(ctx, n, vn) {
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
    drawGlowSprite(ctx, color, vn.x, vn.y, w * 0.8, 0.06 * vn.opacity);
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

export function drawMcpNode(ctx, n, vn) {
  const r = MCP_R * vn.scale;
  const isSelected = state.selected === n.id;
  const isHovered = vis.hoveredNode === n.id;
  const isRunning = n.status === 'running';
  const isError = n.status === 'error';
  const color = isError ? COLORS.error : n.color;

  ctx.save();
  ctx.globalAlpha = vn.opacity;

  if (isRunning) {
    drawGlowSprite(ctx, color, vn.x, vn.y, r * 2.2, 0.09 * vn.opacity);
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

export function drawSkillNode(ctx, n, vn) {
  const r = SKILL_R * vn.scale;
  const isSelected = state.selected === n.id;
  const isHovered = vis.hoveredNode === n.id;
  const isRunning = n.status === 'running';
  const isError = n.status === 'error';
  const color = isError ? COLORS.error : n.color;

  ctx.save();
  ctx.globalAlpha = vn.opacity;

  if (isRunning) {
    drawGlowSprite(ctx, color, vn.x, vn.y, r * 2.2, 0.08 * vn.opacity);
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

// viz-ui.js — feed panel, detail popup, stats, fitView, toolbar, keyboard,
// live durations ticker. All DOM-side presentation concerns.
//
// Wires itself into viz-canvas (pointer-click callbacks) and viz-layout
// (feed-cursor adjust hook) at module load. Circular imports with viz-network
// are fine — all cross-calls happen inside event handlers, after both modules
// are fully initialized.

import {
  COLORS, state, vis, markDirty, hexAlpha, esc,
  formatTokens, tokenTotal, tokenContext, formatCost, agentIdFromNode,
} from './viz-state.js';
import {
  layout, matchesFilter, markLayoutFullDirty, setFeedCursorAdjust,
} from './viz-layout.js';
import * as canvasMod from './viz-canvas.js';
import { setCanvasCallbacks } from './viz-canvas.js';
import {
  loadSessions, resetEvents, setFeedResetHook,
} from './viz-network.js';
import {
  composeNarrator, setRenderFn, resumeTick,
} from './viz-narrator.js';

// ─── Feed panel ───────────────────────────────────────────────────────────
let _feedRenderedCount = 0;
let _feedNeedsFullRebuild = true;

function feedItemHTML(e) {
  const n = state.nodes.get(e.nodeId);
  const dur = n && n.duration ? n.duration : '';
  const isRunning = n && n.status === 'running';
  const color = getTypeColor(e.type);
  const isActive = state.selected === e.nodeId;
  return `<div class="feed-item${isActive ? ' active' : ''}${isRunning ? ' running' : ''}" data-node="${e.nodeId}">
    <div class="feed-dot" style="background:${color};box-shadow:0 0 6px ${hexAlpha(color, 0.4)}"></div>
    <div class="feed-info">
      <div class="feed-label" style="color:${hexAlpha(color, 0.9)}">${esc(e.label)}</div>
      ${e.sub ? `<div class="feed-sub">${esc(e.sub)}</div>` : ''}
    </div>
    <div class="feed-dur">${dur}</div>
  </div>`;
}

export function renderFeed() {
  const list = document.getElementById('feed-list');
  const total = state.timelineEntries.length;
  document.getElementById('feed-count').textContent = `${total} events`;

  if (_feedNeedsFullRebuild || total < _feedRenderedCount) {
    const visible = state.timelineEntries.slice(-60);
    list.innerHTML = visible.map(feedItemHTML).join('');
    _feedRenderedCount = total;
    _feedNeedsFullRebuild = false;
  } else if (total > _feedRenderedCount) {
    const newEntries = state.timelineEntries.slice(_feedRenderedCount);
    const fragment = document.createDocumentFragment();
    const tmp = document.createElement('div');
    for (const e of newEntries) {
      tmp.innerHTML = feedItemHTML(e);
      fragment.appendChild(tmp.firstElementChild);
    }
    list.appendChild(fragment);
    _feedRenderedCount = total;
    while (list.children.length > 60) list.removeChild(list.firstChild);
  }

  list.scrollTop = list.scrollHeight;
}

function getTypeColor(type) {
  const map = { session: COLORS.session, agent: COLORS.agent, tool: COLORS.tool, skill: COLORS.skill, mcp: COLORS.mcp, notification: COLORS.notification, error: COLORS.error };
  return map[type] || COLORS.tool;
}

document.getElementById('feed-list').addEventListener('click', e => {
  const item = e.target.closest('.feed-item');
  if (!item) return;
  const nodeId = item.dataset.node;
  state.selected = nodeId;
  const n = state.nodes.get(nodeId);
  if (n) {
    showDetail(n);
    const vn = vis.nodes.get(nodeId);
    if (vn) {
      vis.camera.targetX = -vn.targetX + (canvasMod.W - 380) / 2 / vis.camera.targetZoom;
      vis.camera.targetY = -vn.targetY + canvasMod.H / 2 / vis.camera.targetZoom;
    }
  }
  renderFeed();
  markDirty();
});

// ─── Detail popup ─────────────────────────────────────────────────────────
export function showDetail(n) {
  const popup = document.getElementById('detail-popup');
  popup.classList.add('visible');

  const color = n.color;
  document.getElementById('detail-type').textContent = n.type.toUpperCase();
  document.getElementById('detail-type').style.color = color;
  document.getElementById('detail-name').textContent = n.label;

  const statusColor = n.status === 'error' ? COLORS.error : n.status === 'running' ? COLORS.notification : COLORS.complete;
  document.getElementById('detail-meta-grid').innerHTML = `
    <div class="meta-card">
      <div class="meta-label">Status</div>
      <div class="meta-value" style="color:${statusColor}">${n.status}</div>
    </div>
    <div class="meta-card">
      <div class="meta-label">Duration</div>
      <div class="meta-value">${n.duration || '—'}</div>
    </div>
    <div class="meta-card">
      <div class="meta-label">Children</div>
      <div class="meta-value">${n.children.length}</div>
    </div>
    <div class="meta-card">
      <div class="meta-label">Type</div>
      <div class="meta-value">${n.type}</div>
    </div>
    ${tokenCardsHTML(n)}
  `;

  document.getElementById('detail-json').textContent = n.data ? JSON.stringify(n.data, null, 2) : '';
}

// For session/agent nodes, render meta-cards with the token breakdown:
// one "Context" card (current window size, matches /context) + cost + model
// (agents only) + 4 cumulative cards. Returns '' when no data.
//
// Drill-down cost lets the user verify the topbar total: clicking each
// subagent should show a cost that, summed with the main thread's, equals
// the topbar pill — useful when a session looks suspiciously expensive.
function tokenCardsHTML(n) {
  if (state.tokens.tokensSupported === false) {
    return `
      <div class="meta-card meta-card-wide">
        <div class="meta-label">Tokens</div>
        <div class="meta-value">N/A</div>
        <div class="meta-sub">Not exposed by this provider</div>
      </div>
    `;
  }
  let bucket = null;
  let contextSize = 0;
  let totalCost = 0;
  let modelLabel = '';
  if (n.type === 'session') {
    // Session's cumulative = main + all subagents (useful for raw volume view).
    bucket = { in: 0, out: 0, cacheCreate: 0, cacheRead: 0 };
    const add = b => { if (!b) return;
      bucket.in += b.in || 0; bucket.out += b.out || 0;
      bucket.cacheCreate += b.cacheCreate || 0; bucket.cacheRead += b.cacheRead || 0;
      totalCost += b.costUsd || 0; };
    add(state.tokens.main);
    for (const b of state.tokens.perAgent.values()) add(b);
    // Context size = main thread only (matches what /context reports).
    contextSize = tokenContext(state.tokens.main);
  } else if (n.type === 'agent') {
    const aid = agentIdFromNode(n.id);
    bucket = aid ? state.tokens.perAgent.get(aid) : null;
    contextSize = tokenContext(bucket);
    totalCost = (bucket && bucket.costUsd) || 0;
    modelLabel = (bucket && bucket.lastModel) ? labelForModel(bucket.lastModel) : '';
  }
  if (!bucket || tokenTotal(bucket) === 0) return '';
  const ctxCard = contextSize > 0
    ? `<div class="meta-card"><div class="meta-label">Context (current)</div><div class="meta-value">${formatTokens(contextSize)}</div></div>`
    : '';
  const modelCard = modelLabel
    ? `<div class="meta-card"><div class="meta-label">Model</div><div class="meta-value">${esc(modelLabel)}</div></div>`
    : '';
  const costCard = totalCost > 0
    ? `<div class="meta-card"><div class="meta-label">Cost (cumul.)</div><div class="meta-value">${formatCost(totalCost)}</div></div>`
    : '';
  return `
    ${modelCard}
    ${ctxCard}
    ${costCard}
    <div class="meta-card"><div class="meta-label">Input (cumul.)</div><div class="meta-value">${formatTokens(bucket.in)}</div></div>
    <div class="meta-card"><div class="meta-label">Output (cumul.)</div><div class="meta-value">${formatTokens(bucket.out)}</div></div>
    <div class="meta-card"><div class="meta-label">Cache read (cumul.)</div><div class="meta-value">${formatTokens(bucket.cacheRead)}</div></div>
    <div class="meta-card"><div class="meta-label">Cache create (cumul.)</div><div class="meta-value">${formatTokens(bucket.cacheCreate)}</div></div>
  `;
}

document.getElementById('detail-close').addEventListener('click', () => {
  document.getElementById('detail-popup').classList.remove('visible');
  state.selected = null;
  renderFeed();
  markDirty();
});

// ─── Budget pill (model · context% · cost) ───────────────────────────────
// Driven by SSE `tokens` snapshots — see viz-network.js. Reads only the main
// thread bucket (matches what /context reports); subagent costs are folded in
// for the cumulative dollar amount.
const _budgetEls = {
  pill: null, model: null, ctx: null, cost: null,
};
function _budgetDOM() {
  if (!_budgetEls.pill) {
    _budgetEls.pill = document.getElementById('budget-pill');
    _budgetEls.model = document.getElementById('budget-model');
    _budgetEls.ctx = document.getElementById('budget-ctx');
    _budgetEls.cost = document.getElementById('budget-cost');
  }
  return _budgetEls;
}

export function updateBudget() {
  const els = _budgetDOM();
  if (!els.pill) return;

  // Adapter explicitly declared tokens unavailable for this provider.
  if (state.tokens.tokensSupported === false) {
    els.model.textContent = '';
    els.ctx.textContent = 'Tokens N/A';
    els.cost.textContent = '';
    els.ctx.classList.remove('is-warn', 'is-crit');
    els.pill.title = 'Token usage is not exposed by this provider (e.g. Copilot Chat).';
    els.pill.hidden = false;
    return;
  }

  // Token tracking is on (Claude) but the transcript file hasn't been located
  // yet — surface it explicitly rather than leaving the pill blank.
  if (state.tokens.transcriptMissing) {
    els.model.textContent = '';
    els.ctx.textContent = 'Transcript N/A';
    els.cost.textContent = '';
    els.ctx.classList.remove('is-warn', 'is-crit');
    els.pill.title = 'Transcript file not located yet — token tracking starts as soon as it appears on disk.';
    els.pill.hidden = false;
    return;
  }

  const main = state.tokens.main;
  // Hide while we have no model info yet — the pill flickering empty is worse
  // than not appearing until the first assistant message lands.
  if (!main || !main.lastModel || !main.contextMax) {
    els.pill.hidden = true;
    return;
  }
  const ctxNow = tokenContext(main);
  const ratio = ctxNow / main.contextMax;
  // Cumulative cost = main + every subagent bucket (each computed against its
  // own model on the server side, so a multi-model session sums cleanly).
  let totalCost = main.costUsd || 0;
  for (const b of state.tokens.perAgent.values()) totalCost += b.costUsd || 0;

  els.model.textContent = labelForModel(main.lastModel);
  els.ctx.textContent = `${formatTokens(ctxNow)} / ${formatTokens(main.contextMax)} (${(ratio * 100).toFixed(1)}%)`;
  els.cost.textContent = formatCost(totalCost);
  els.ctx.classList.toggle('is-warn', ratio >= 0.7 && ratio < 0.9);
  els.ctx.classList.toggle('is-crit', ratio >= 0.9);
  els.pill.title = `Model: ${main.lastModel}\nContext: ${ctxNow.toLocaleString()} / ${main.contextMax.toLocaleString()} tokens\nCost (this session): ${formatCost(totalCost)}`;
  els.pill.hidden = false;
}

// Cheap client-side label derivation — matches the server's deriveLabel() so
// we don't have to ship the price map to the client just for display names.
function labelForModel(id) {
  if (!id) return '';
  const m = id.match(/^claude-(opus|sonnet|haiku)-(\d+)-(\d+)/);
  if (m) return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}.${m[3]}`;
  return id;
}

// ─── Narrator (live caption under topbar) ─────────────────────────────────
// renderNarrator pulls the composed string from viz-narrator and updates the
// DOM. Registered as the narrator's render callback at module init — the
// narrator module then drives updates via markNarratorDirty() (event-driven)
// and a 1 Hz tick (resumeTick) for "Xs ago" clocks.
const _narrEl = document.getElementById('narrator');

export function renderNarrator() {
  if (!_narrEl) return;
  const result = composeNarrator(state, vis, Date.now());
  if (!result) {
    _narrEl.hidden = true;
    _narrEl.textContent = '';
    _narrEl.removeAttribute('data-tone');
    return;
  }
  _narrEl.hidden = false;
  _narrEl.textContent = result.text;
  _narrEl.dataset.tone = result.tone;
}

// ─── Stats ────────────────────────────────────────────────────────────────
export function updateStats() {
  let running = 0, agents = 0, errors = 0;
  for (const n of state.nodes.values()) {
    if (n.type === 'agent') agents++;
    if (n.status === 'error') errors++;
    if (n.status === 'running') running++;
  }
  document.getElementById('stat-tools').textContent = state.toolsCompleted;
  document.getElementById('stat-agents').textContent = agents;

  const runEl = document.getElementById('stat-running');
  runEl.textContent = running;
  runEl.classList.toggle('has-running', running > 0);

  const errEl = document.getElementById('stat-errors');
  errEl.textContent = errors;
  errEl.classList.toggle('has-errors', errors > 0);
}

// ─── Fit view ─────────────────────────────────────────────────────────────
export function fitView() {
  if (!state.nodes.size) return;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const vn of vis.nodes.values()) {
    if (vn.targetOpacity < 0.1) continue;
    minX = Math.min(minX, vn.targetX - 60);
    maxX = Math.max(maxX, vn.targetX + 60);
    minY = Math.min(minY, vn.targetY - 60);
    maxY = Math.max(maxY, vn.targetY + 60);
  }
  if (!isFinite(minX)) return;

  const availW = canvasMod.W - 380;
  const pad = 80;
  const w = maxX - minX + pad * 2;
  const h = maxY - minY + pad * 2;
  const zoom = Math.min(availW / w, canvasMod.H / h, 2);
  vis.camera.targetZoom = zoom;
  vis.camera.targetX = -(minX + maxX) / 2 + availW / 2 / zoom;
  vis.camera.targetY = -(minY + maxY) / 2 + canvasMod.H / 2 / zoom;
}

// ─── Toolbar buttons (id-bound, no inline handlers) ───────────────────────
export function toggleSessions() {
  document.getElementById('sessions-overlay').classList.toggle('visible');
}

export function toggleAutoFit() {
  state.autoFit = !state.autoFit;
  document.getElementById('autofit-label').textContent = state.autoFit ? 'ON' : 'OFF';
  if (state.autoFit) { fitView(); markDirty(); }
}

document.getElementById('btn-sessions').addEventListener('click', toggleSessions);
document.getElementById('btn-fit').addEventListener('click', () => { fitView(); markDirty(); });
document.getElementById('btn-clear').addEventListener('click', resetEvents);
document.getElementById('btn-autofit').addEventListener('click', toggleAutoFit);

// ─── Keyboard + search ────────────────────────────────────────────────────
const searchBox = document.getElementById('search-box');

document.addEventListener('keydown', e => {
  if (e.target === searchBox) {
    if (e.key === 'Escape') {
      searchBox.blur();
      searchBox.value = '';
      state.filter = '';
      markLayoutFullDirty();
      layout();
      markDirty();
    }
    return;
  }
  if (e.key === 'f' || e.key === 'F') { fitView(); markDirty(); }
  if (e.key === 'c' || e.key === 'C') resetEvents();
  if (e.key === 's' || e.key === 'S') toggleSessions();
  if (e.key === '/') { e.preventDefault(); searchBox.focus(); }
  if (e.key === 'Escape') {
    state.selected = null;
    document.getElementById('detail-popup').classList.remove('visible');
    document.getElementById('sessions-overlay').classList.remove('visible');
    renderFeed();
    markDirty();
  }
});

searchBox.addEventListener('input', () => {
  state.filter = searchBox.value.toLowerCase();
  markLayoutFullDirty();
  layout();
  markDirty();
});

// ─── Live durations ticker (only runs while a node is running) ────────────
let _durationsTimer = null;
export function startDurationsTicker() {
  if (_durationsTimer != null) return;
  _durationsTimer = setInterval(updateLiveDurations, 1000);
}
export function stopDurationsTicker() {
  if (_durationsTimer != null) { clearInterval(_durationsTimer); _durationsTimer = null; }
}

function updateLiveDurations() {
  let anyRunning = false;
  const now = new Date();
  for (const n of state.nodes.values()) {
    if (n.status === 'running' && n.startTime) {
      anyRunning = true;
      const ms = now - new Date(n.startTime);
      n.duration = ms < 1000 ? `${ms}ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)}s` : `${(ms / 60000).toFixed(1)}m`;
    }
  }
  if (!anyRunning) {
    stopDurationsTicker();
    return;
  }
  for (const el of document.querySelectorAll('.feed-item.running')) {
    const nodeId = el.dataset.node;
    const n = state.nodes.get(nodeId);
    if (n) {
      const durEl = el.querySelector('.feed-dur');
      if (durEl) durEl.textContent = n.duration || '';
    }
  }
  markDirty();
}

// ─── Wire cross-module hooks ──────────────────────────────────────────────
// Canvas pointer click → detail + feed highlight.
setCanvasCallbacks({ showDetail, renderFeed });

// Layout timeline ring-buffer shift → keep feed cursor consistent.
setFeedCursorAdjust(drop => {
  _feedRenderedCount = Math.max(0, _feedRenderedCount - drop);
});

// Network clearState → reset feed cursor so next renderFeed rebuilds.
setFeedResetHook(() => {
  _feedRenderedCount = 0;
  _feedNeedsFullRebuild = true;
});

// Narrator: register render callback and start the 1 Hz tick.
setRenderFn(renderNarrator);
resumeTick();

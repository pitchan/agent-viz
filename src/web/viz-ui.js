// viz-ui.js — feed panel, detail popup, stats, fitView, toolbar, keyboard,
// live durations ticker. All DOM-side presentation concerns.
//
// Wires itself into viz-canvas (pointer-click callbacks) and viz-layout
// (feed-cursor adjust hook) at module load. Circular imports with viz-network
// are fine — all cross-calls happen inside event handlers, after both modules
// are fully initialized.

import {
  COLORS, state, vis, markDirty, hexAlpha, esc,
  formatTokens, tokenTotal, tokenContext, formatCost, formatCostBound, costCompleteness,
  agentIdFromNode,
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
import {
  getActiveAlerts, acknowledgeAlert, onAlertsChanged, initAlertReader, refreshAlerts,
} from './viz-watchdog-client.js';
import {
  alertActor, alertDetailLines, notificationPayload, truncate,
} from './viz-alert-format.mjs';
import { watchdogPresentation, errorsPresentation } from './viz-topbar-status.mjs';
import { errorRow, errorsPanelTitle } from './viz-error-format.mjs';
import { getErrors, getErrorsSummary, onErrorsChanged } from './viz-errors.mjs';
import { formatDuration } from './viz-duration.mjs';

// ─── Feed panel ───────────────────────────────────────────────────────────
let _feedRenderedCount = 0;
let _feedNeedsFullRebuild = true;

// Feed rows are appended once and never re-rendered, so anything that changes
// an EXISTING row — a call that just failed and must turn red — has to ask for
// a rebuild rather than wait for one to happen by chance.
function markFeedFullRebuild() { _feedNeedsFullRebuild = true; }

function feedItemHTML(e) {
  const n = state.nodes.get(e.nodeId);
  const dur = n && n.duration ? n.duration : '';
  const isRunning = n && n.status === 'running';
  // Status wins over type. A failed Read used to carry the same amber dot as
  // twenty successful ones — measured in the browser: twenty-one identical
  // dots, not one of them red. The error colour was already in getTypeColor,
  // simply never reached, because no timeline entry is ever of type 'error'.
  const color = (n && n.status === 'error') ? COLORS.error : getTypeColor(e.type);
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

// Select a node, open its detail, and bring the camera to it. Shared by the
// feed and the errors popup: both are lists that lead to the same place, and a
// second copy of the camera arithmetic would drift from this one.
//
// A node that no longer exists is not an error here — the GC drops finished
// tools after ten minutes, and an errors-popup row outlives its node on
// purpose. Nothing is selected in that case, and the caller's row stays
// readable on its own.
export function focusNode(nodeId) {
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
  // La selection change une ligne DEJA rendue, et le flux ne fait qu'ajouter :
  // sans forcer, le surlignage n'apparaissait qu'a la prochaine reconstruction
  // fortuite. C'est un clic d'utilisateur, pas un evenement de flux — repeindre
  // soixante lignes est sans effet mesurable, et le geste se voit arriver.
  markFeedFullRebuild();
  renderFeed();
  markDirty();
  return Boolean(n);
}

document.getElementById('feed-list').addEventListener('click', e => {
  const item = e.target.closest('.feed-item');
  if (!item) return;
  focusNode(item.dataset.node);
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
  // C4 : la même réserve que la pastille. Sans ça, le montant honnête de la
  // barre du haut et un montant net de toute réserve dans le panneau de détail
  // cohabiteraient à un clic l'un de l'autre — le constat rouvert un cran plus
  // bas.
  let cout = { complete: true, unknownModels: [] };
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
    cout = costCompleteness([state.tokens.main, ...state.tokens.perAgent.values()]);
  } else if (n.type === 'agent') {
    const aid = agentIdFromNode(n.id);
    bucket = aid ? state.tokens.perAgent.get(aid) : null;
    contextSize = tokenContext(bucket);
    totalCost = (bucket && bucket.costUsd) || 0;
    modelLabel = (bucket && bucket.lastModel) ? labelForModel(bucket.lastModel) : '';
    cout = costCompleteness([bucket]);
  }
  if (!bucket || tokenTotal(bucket) === 0) return '';
  const ctxCard = contextSize > 0
    ? `<div class="meta-card"><div class="meta-label">Context (current)</div><div class="meta-value">${formatTokens(contextSize)}</div></div>`
    : '';
  const modelCard = modelLabel
    ? `<div class="meta-card"><div class="meta-label">Model</div><div class="meta-value">${esc(modelLabel)}</div></div>`
    : '';
  // C4 : la carte s'affiche AUSSI quand le montant est nul mais incomplet —
  // sinon une session dont aucun modèle n'est tarifé ferait disparaître la
  // carte, et l'absence se lirait comme « rien dépensé ».
  const costCard = (totalCost > 0 || !cout.complete)
    ? `<div class="meta-card"><div class="meta-label">Cost (cumul.)</div>`
      + `<div class="meta-value">${esc(formatCostBound(totalCost, cout.complete))}</div>`
      + (cout.complete ? ''
        : `<div class="meta-sub">coût partiel — sans tarif : ${esc(cout.unknownModels.join(', '))}</div>`)
      + `</div>`
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
  //
  // C4 (2026-08-11) : la condition ne porte plus sur `contextMax`. Le serveur
  // ne posait `lastModel` que pour un modèle TARIFÉ, si bien qu'une session
  // n'employant que des modèles hors table faisait disparaître la pastille
  // entièrement — ni coût, ni contexte, ni modèle, alors que le modèle et le
  // volume de jetons, eux, sont parfaitement connus. Seule la FENÊTRE manque.
  if (!main || !main.lastModel) {
    els.pill.hidden = true;
    return;
  }
  const ctxNow = tokenContext(main);
  const fenetreConnue = main.contextMax > 0;
  const ratio = fenetreConnue ? ctxNow / main.contextMax : 0;
  // Cumulative cost = main + every subagent bucket (each computed against its
  // own model on the server side, so a multi-model session sums cleanly).
  let totalCost = main.costUsd || 0;
  for (const b of state.tokens.perAgent.values()) totalCost += b.costUsd || 0;
  // C4 : la même somme porte sa réserve. Un seul seau incomplet suffit à
  // rendre le total incomplet.
  const cout = costCompleteness([main, ...state.tokens.perAgent.values()]);

  els.model.textContent = labelForModel(main.lastModel);
  // Sans fenêtre connue, la taille absolue et RIEN d'autre : un pourcentage
  // calculé contre une fenêtre inventée serait pire que pas de pourcentage.
  els.ctx.textContent = fenetreConnue
    ? `${formatTokens(ctxNow)} / ${formatTokens(main.contextMax)} (${(ratio * 100).toFixed(1)}%)`
    : formatTokens(ctxNow);
  els.cost.textContent = formatCostBound(totalCost, cout.complete);
  els.ctx.classList.toggle('is-warn', fenetreConnue && ratio >= 0.7 && ratio < 0.9);
  els.ctx.classList.toggle('is-crit', fenetreConnue && ratio >= 0.9);
  els.pill.title = [
    `Model: ${main.lastModel}`,
    fenetreConnue
      ? `Context: ${ctxNow.toLocaleString()} / ${main.contextMax.toLocaleString()} tokens`
      : `Context: ${ctxNow.toLocaleString()} tokens (fenêtre inconnue pour ce modèle)`,
    `Cost (this session): ${formatCostBound(totalCost, cout.complete)}`,
    ...(cout.complete ? [] : [
      totalCost > 0
        ? `Coût PARTIEL — modèles sans tarif connu : ${cout.unknownModels.join(', ')}`
        : `Aucun modèle tarifé — sans tarif connu : ${cout.unknownModels.join(', ')}`,
      totalCost > 0
        ? 'Le coût réel est supérieur.'
        : 'Les jetons sont comptés ; le coût n’est pas calculable.',
    ]),
  ].join('\n');
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
  let running = 0, agents = 0;
  for (const n of state.nodes.values()) {
    if (n.type === 'agent') agents++;
    if (n.status === 'running') running++;
  }
  document.getElementById('stat-tools').textContent = state.toolsCompleted;
  document.getElementById('stat-agents').textContent = agents;

  const runEl = document.getElementById('stat-running');
  runEl.textContent = running;
  runEl.classList.toggle('has-running', running > 0);

  // The error count is NOT derived from the nodes any more. Deriving it made
  // the chip lie twice: the GC drops a finished tool node after ten minutes
  // (the count fell back to zero on its own) while agent nodes are never
  // dropped (those errors stayed forever) — one number, two lifetimes. The
  // registry counts what actually happened in this session. Keeping the old
  // scan alongside it would put two different totals one click apart, which is
  // the mistake the C4 note above already commemorates for cost.
  renderErrorsPill();
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
    document.getElementById('alerts-popup').classList.remove('visible');
    document.getElementById('errors-popup').classList.remove('visible');
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
      // Même format que les nœuds terminés (constat C8) : le compteur qui tourne
      // et le chiffre figé ne peuvent pas s'écrire différemment. Une durée
      // impossible ne remplace pas la précédente — la ligne du fil la tait
      // (`n.duration || ''`), et c'est exactement ce qu'on veut y voir.
      const ecrite = formatDuration(now - new Date(n.startTime));
      if (ecrite !== null) n.duration = ecrite;
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

// ─── Watchdog pill + alerts popup ─────────────────────────────────────────
// Reads from viz-watchdog-client (the source of truth for alerts). The pill
// is always present in the topbar — green = quiet, red+pulse = at least one
// non-acknowledged alert. Click opens a popup with one row per alert and an
// Ack button. New alerts also trigger a desktop Notification (permission is
// requested lazily on the first incoming alert; silent fallback if denied).

const _watchdogEls = { pill: null, count: null, popup: null, list: null };
function _watchdogDOM() {
  if (!_watchdogEls.pill) {
    _watchdogEls.pill = document.getElementById('watchdog-pill');
    _watchdogEls.count = document.getElementById('watchdog-count');
    _watchdogEls.popup = document.getElementById('alerts-popup');
    _watchdogEls.list = document.getElementById('alerts-list');
  }
  return _watchdogEls;
}

// The wording comes from viz-alert-format (shared with the OS notification);
// this function only decides which element each line lands in.
function alertItemHTML(a) {
  const subject = a.subject
    ? `<div class="alert-subject">${esc(truncate(a.subject))}</div>` : '';
  const details = alertDetailLines(a)
    .map(line => `<div class="alert-detail">${esc(line)}</div>`).join('');
  const meta = [
    a.sessionId ? `session ${a.sessionId.slice(0, 8)}` : a.toolName || '',
    a.type === 'stuck' ? '' : alertActor(a),
  ].filter(Boolean).join(' · ');
  return `<div class="alert-item">
    <div class="alert-info">
      <div class="alert-type">${esc(a.type)}</div>
      <div class="alert-msg">${esc(a.message)}</div>
      ${subject}
      ${details}
      <div class="alert-meta">${esc(meta)}</div>
    </div>
    <button class="alert-ack" data-id="${esc(a.id)}" data-created="${esc(String(a.createdAt ?? ''))}">Ack</button>
  </div>`;
}

function renderAlertsPopup() {
  const els = _watchdogDOM();
  const active = getActiveAlerts();
  els.list.innerHTML = active.length
    ? active.map(alertItemHTML).join('')
    : '<div class="alerts-empty">No active alerts.</div>';
}

export function renderWatchdogPill() {
  const els = _watchdogDOM();
  // The words come from viz-topbar-status, where a unit test pins them; this
  // only applies them. The aria-label is the button's accessible name — its
  // only visible content is an icon.
  const p = watchdogPresentation(getActiveAlerts().length);
  els.pill.classList.toggle('has-alerts', p.hasAlerts);
  els.count.hidden = p.countText === null;
  els.count.textContent = p.countText ?? '';
  els.pill.title = p.title;
  els.pill.setAttribute('aria-label', p.ariaLabel);
  if (els.popup.classList.contains('visible')) renderAlertsPopup();
}

document.getElementById('watchdog-pill').addEventListener('click', () => {
  const popup = document.getElementById('alerts-popup');
  const opening = !popup.classList.contains('visible');
  popup.classList.toggle('visible', opening);
  if (opening) renderAlertsPopup();
});

document.getElementById('alerts-close').addEventListener('click', () => {
  document.getElementById('alerts-popup').classList.remove('visible');
});

document.getElementById('alerts-list').addEventListener('click', (e) => {
  const btn = e.target.closest('.alert-ack');
  if (!btn) return;
  // Both halves of the key: the same id at another time is another incident.
  acknowledgeAlert(btn.dataset.id, Number(btn.dataset.created));
  renderWatchdogPill();
});

// ─── Errors chip + errors popup ───────────────────────────────────────────
// The third topbar witness, and the one that stayed mute the longest: it read
// "1 errors" with no way in, while the failure's own message was already in
// the page, one unmarked click away. It follows the watchdog bell's shape —
// a counting button that opens a list — with one difference that matters: an
// alert is acknowledged, an error is only read. There is no Ack here.
//
// Rows come from the registry, not from the graph, so a row survives the node
// it points at. When the node is gone the row stays and simply stops promising
// a jump.

const _errorsEls = { pill: null, count: null, label: null, popup: null, list: null, title: null };
function _errorsDOM() {
  if (!_errorsEls.pill) {
    _errorsEls.pill = document.getElementById('errors-pill');
    _errorsEls.count = document.getElementById('stat-errors');
    _errorsEls.label = document.getElementById('stat-errors-label');
    _errorsEls.popup = document.getElementById('errors-popup');
    _errorsEls.list = document.getElementById('errors-list');
    _errorsEls.title = document.getElementById('errors-title');
  }
  return _errorsEls;
}

// `esc` on every field without exception: an error message is arbitrary text —
// paths, quotes, angle brackets, whatever the failing tool happened to print.
function errorItemHTML(rec) {
  // La presence du noeud se decide ICI, contre le graphe reel. Le module de
  // formatage ne connait pas le graphe : lui laisser deduire la rejoignabilite
  // de l'identifiant annoncait une ligne cliquable qui ne menait nulle part.
  const row = errorRow(rec, Boolean(rec.nodeId) && state.nodes.has(rec.nodeId));
  return `<div class="error-item${row.reachable ? ' reachable' : ''}"${row.reachable ? ` data-node="${esc(row.nodeId)}"` : ''}>
    <div class="error-head">
      <span class="error-tool">${esc(row.tool)}${row.repeat ? ` <span class="error-repeat">${esc(row.repeat)}</span>` : ''}</span>
      <span class="error-time">${esc(row.time)}</span>
    </div>
    ${row.subject ? `<div class="error-subject">${esc(row.subject)}</div>` : ''}
    <div class="error-msg">${esc(row.message)}</div>
    ${row.sinceNote ? `<div class="error-since">${esc(row.sinceNote)}</div>` : ''}
    ${row.goneNote ? `<div class="error-gone">${esc(row.goneNote)}</div>` : ''}
  </div>`;
}

function renderErrorsPopup() {
  const els = _errorsDOM();
  const recs = getErrors();
  // Newest first: the error being looked for is almost always the last one.
  const shown = recs.slice().reverse();
  // The session is named ONCE, in the header, rather than on every row: the
  // tab only ever shows one session, and repeating it would push the message
  // — the only part that explains anything — out of view.
  const sid = recs.length ? recs[recs.length - 1].sessionId : (state._lastServerId || '');
  // Le titre dit le TOTAL des echecs, pas le nombre de lignes : deux
  // occurrences empilees restent deux echecs aux yeux du chiffre.
  els.title.textContent = errorsPanelTitle(sid, getErrorsSummary().total);
  els.list.innerHTML = shown.length
    ? shown.map(errorItemHTML).join('')
    : '<div class="errors-empty">No tool errors in this session.</div>';
}

export function renderErrorsPill() {
  const els = _errorsDOM();
  // The words come from viz-topbar-status, where a unit test pins them —
  // including the plural that made the chip read "1 errors". Two exclusive
  // classes carry the two states: amber for "errors happened, session moved
  // on", red only when the registry's facts say the session needs eyes now.
  const p = errorsPresentation(getErrorsSummary());
  els.count.textContent = p.countText;
  els.count.classList.toggle('has-errors', p.hasErrors && !p.alarm);
  els.count.classList.toggle('has-errors-alarm', p.alarm);
  els.label.textContent = p.label;
  els.pill.title = p.title;
  els.pill.setAttribute('aria-label', p.ariaLabel);
  if (els.popup.classList.contains('visible')) renderErrorsPopup();
}

document.getElementById('errors-pill').addEventListener('click', () => {
  const popup = document.getElementById('errors-popup');
  const opening = !popup.classList.contains('visible');
  popup.classList.toggle('visible', opening);
  if (opening) renderErrorsPopup();
});

document.getElementById('errors-close').addEventListener('click', () => {
  document.getElementById('errors-popup').classList.remove('visible');
});

document.getElementById('errors-list').addEventListener('click', (e) => {
  const item = e.target.closest('.error-item.reachable');
  if (!item) return;
  focusNode(item.dataset.node);
});

// A new error repaints the chip, and forces a full feed rebuild so the row
// that just turned red actually turns red: feed rows are appended once and
// never re-rendered. Errors are rare — median one per session, measured over
// thirty days — so rebuilding sixty rows costs nothing.
//
// A SUCCESS notification is a different economy: it fires on every tool call
// once an error is on the board, and it changes no feed row's color. It only
// ages the chip — and the popup rows' "N tools succeeded since", which
// renderErrorsPill already refreshes when the popup is open.
onErrorsChanged((_recs, reason) => {
  if (reason === 'success') { renderErrorsPill(); return; }
  markFeedFullRebuild();
  renderFeed();
  renderErrorsPill();
});

// Initial render so the chip is correct and named from the first paint.
renderErrorsPill();

// Lazy permission request — only on the first alert, never at page load.
// Browsers dedupe by `tag`, so re-emitting a notification with the same id
// is harmless (the OS toast updates in place).
let _notifPermAsked = false;
function notifyDesktop(alert) {
  if (typeof Notification === 'undefined') return;
  if (Notification.permission === 'default' && !_notifPermAsked) {
    _notifPermAsked = true;
    Notification.requestPermission().catch(() => {});
  }
  if (Notification.permission !== 'granted') return;
  const { title, body } = notificationPayload(alert);
  try { new Notification(title, { body, tag: alert.id }); }
  catch {}
}

onAlertsChanged((alerts) => {
  renderWatchdogPill();
  for (const a of alerts) notifyDesktop(a);
});

// Initial render so the pill is green from the first paint.
renderWatchdogPill();

// The badge reads the server's journal: once at load, then every 30s to catch
// up on whatever a broken stream missed. Live pushes come through SSE.
//
// `finally`, not `then`: a first read that failed is a reason to keep trying,
// not to stop before starting. Chained off `then` — as this line first was —
// one rejection at load would leave the timer unarmed and the badge frozen on
// an empty list for the rest of the session, saying nothing. Whatever refuses
// is said out loud for the same reason.
initAlertReader()
  .catch(err => console.error('[viz] first alert read failed:', err))
  .finally(() => setInterval(refreshAlerts, 30_000));

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

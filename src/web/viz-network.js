// viz-network.js — SSE, poll fallback, sessions API, visibility pause.
//
// Owns the server connection (EventSource + poll loop), the current session
// selection, and the pause/resume lifecycle. Events come in here, are handed
// to viz-layout (processEvent, layout), and trigger viz-ui (renderFeed,
// updateStats, fitView) via `scheduleRender` which coalesces bursts.

import { state, vis, markDirty, esc } from './viz-state.js';
import { processEvent, layout, resetLayout } from './viz-layout.js';
import {
  renderFeed, updateStats, updateBudget, fitView, startDurationsTicker, stopDurationsTicker,
} from './viz-ui.js';
import {
  pauseTick, resumeTick, markNarratorDirty,
} from './viz-narrator.js';
import { raiseExternalAlert, applyServerAlert, refreshAlerts } from './viz-watchdog-client.js';
import { connectionPresentation } from './viz-topbar-status.mjs';

// Nothing here tells the watchdog whether we can still hear the agent. That
// question belonged to a detector running in the tab; detection now runs on
// the server, which keeps listening whether or not a tab is open, and answers
// it from its own catch-up state.

// Render a small pill badge identifying the source agent. Returns HTML safe to
// inline (label is fixed, no user input).
function badgeHtml(agentSource) {
  if (agentSource !== 'claude' && agentSource !== 'copilot') return '';
  const src = agentSource;
  return `<span class="agent-badge agent-${src}">${src}</span>`;
}

// ─── DOM refs ─────────────────────────────────────────────────────────────
const connStatus = document.getElementById('connection-status');
const connLabel = document.getElementById('connection-label');

// The words come from viz-topbar-status, where a unit test pins them; this
// only applies them. Called once at load: the witness must already say
// OFFLINE while the first connection attempt is still in flight.
function renderConnection(connected) {
  const p = connectionPresentation(connected);
  connStatus.classList.toggle('connected', connected);
  connLabel.textContent = p.label;
  connStatus.title = p.title;
}
renderConnection(false);

// The daemon's version, fetched once at load: the topbar identifies WHICH
// daemon is serving — the number that runs, not the number on disk. A daemon
// too old to have /version leaves the span empty; guessing would be worse.
fetch('/version')
  .then(r => r.json())
  .then(({ version }) => {
    document.getElementById('app-version').textContent = `v${version}`;
  })
  .catch(() => {});

// ─── Session selection (owned here, read-only from elsewhere) ─────────────
export let currentSessionId = null;
export const sessionTitles = new Map();
export const sessionAgents = new Map(); // sid → 'claude' | 'copilot'

// ─── SSE + poll state ─────────────────────────────────────────────────────
let sseSource = null;
let sseConnected = false;
let firstBatch = true, clearing = false;

// Render coalescer — collapses bursts into one layout/render per microtask.
let _pendingRender = false;
let _pendingFitView = false;
export function scheduleRender() {
  if (_pendingRender) return;
  _pendingRender = true;
  queueMicrotask(() => {
    _pendingRender = false;
    layout();
    renderFeed();
    updateStats();
    if (_pendingFitView && state.autoFit && state.nodes.size) {
      fitView();
    }
    _pendingFitView = false;
    // Arm live-duration ticker if any node is still running.
    for (const n of state.nodes.values()) {
      if (n.status === 'running') { startDurationsTicker(); break; }
    }
    markDirty();
  });
}

// ─── Poll fallback (only active while SSE is disconnected) ────────────────
let _pollFallbackTimer = null;
function startPollFallback() {
  if (_pollFallbackTimer != null) return;
  const loop = () => {
    _pollFallbackTimer = null;
    if (sseConnected) return;
    poll().finally(() => {
      if (!sseConnected) _pollFallbackTimer = setTimeout(loop, 5000);
    });
  };
  _pollFallbackTimer = setTimeout(loop, 5000);
}
function stopPollFallback() {
  if (_pollFallbackTimer != null) { clearTimeout(_pollFallbackTimer); _pollFallbackTimer = null; }
}

// ─── SSE ──────────────────────────────────────────────────────────────────
export function connectSSE() {
  if (sseSource) sseSource.close();
  sseSource = new EventSource('/stream');
  sseSource.onopen = () => {
    sseConnected = true;
    renderConnection(true);
    stopPollFallback();
  };
  sseSource.onerror = () => {
    sseConnected = false;
    renderConnection(false);
    startPollFallback();
  };
  sseSource.onmessage = (msg) => {
    try {
      const data = JSON.parse(msg.data);
      // One alert per drifted model, stable id — the client-side dedup contract
      // (same id active → no refire) matches the watchdog's.
      function pricingDriftAlert(d) {
        return {
          id: `pricingDrift:${d.model}`,
          type: 'pricingDrift', sessionId: '', toolName: d.model, count: 1,
          createdAt: Date.now(),
          // Une dérive tarifaire est un état, pas un moment : elle reste vraie
          // tant que la table embarquée n'a pas bougé. Les deux tableaux vides
          // complètent la forme uniforme, pour qu'un consommateur puisse lire
          // n'importe quel champ sans savoir d'où l'alerte vient.
          standing: true, occurrences: [], tools: [],
          message: d.kind === 'modele-nouveau'
            ? `Vigie tarifaire : ${d.model} existe chez LiteLLM mais pas dans la table embarquée`
            : `Vigie tarifaire : le tarif de ${d.model} diffère entre LiteLLM et la table embarquée`,
        };
      }
      // Observatory scan progress: re-broadcast as a DOM event so the advisor
      // panel can follow it without this module importing the observatory.
      if (data.type === 'analysisScan') {
        window.dispatchEvent(new CustomEvent('agentviz:analysisScan', { detail: data }));
        return;
      }
      // The server has just recorded a failure: show it without waiting for
      // the next poll. The journal stays the source of truth — this is only a
      // display shortcut.
      if (data.type === 'alert') {
        applyServerAlert(data.alert);
        return;
      }
      if (data.type === 'pricingDrift') {
        for (const d of data.drifts) raiseExternalAlert(pricingDriftAlert(d));
        return;
      }
      if (data.type === 'sessionsChanged') {
        loadSessions();
        return;
      }
      if (data.type === 'tokens') {
        const target = currentSessionId || state._lastServerId;
        if (!target || data.session === target) applyTokens(data);
        return;
      }
      if (data.type === 'event') {
        const target = currentSessionId || state._lastServerId;
        if (!target || data.session === target) {
          if (!currentSessionId && !state._lastServerId) {
            state._lastServerId = data.session;
            updateTopbarPrompt();
          }
          state.eventSeq++;
          processEvent(data.event);
          if (state.autoFit && (firstBatch || state.nodes.size)) _pendingFitView = true;
          scheduleRender();
        }
      }
    } catch {}
  };
}

// ─── Token snapshots ──────────────────────────────────────────────────────
// Apply a `tokens` snapshot (SSE message or /tokens response) to state and
// refresh the budget pill. Single application path for both sources.
function applyTokens(data) {
  state.tokens.main = data.main || null;
  state.tokens.perAgent.clear();
  if (data.perAgent) {
    for (const [aid, bucket] of Object.entries(data.perAgent)) {
      state.tokens.perAgent.set(aid, bucket);
    }
  }
  // Server sends true for Claude, false for Copilot, omits for legacy events.
  // Treat anything other than literal `false` as supported (don't break Claude).
  state.tokens.tokensSupported = (data.tokensSupported !== false);
  state.tokens.transcriptMissing = !!data.transcriptMissing;
  updateBudget();
  markDirty();
}

// Fetch a specific session's token snapshot. The SSE stream only pushes
// `tokens` for the live/active session, so a session picked from the overlay
// needs this one-shot fetch to populate the budget pill.
async function fetchTokens(sid) {
  try {
    const res = await fetch(`/tokens?session=${encodeURIComponent(sid)}`);
    const msg = await res.json();
    // Drop if the user switched sessions while the request was in flight.
    if (sid !== currentSessionId || !msg) return;
    applyTokens(msg);
  } catch {}
}

// ─── Poll ─────────────────────────────────────────────────────────────────
export async function poll(force) {
  if (clearing || (!force && sseConnected)) return;
  try {
    const sp = currentSessionId ? `&session=${currentSessionId}` : '';
    const res = await fetch(`/events?offset=${state.offset}${sp}`);
    const size = parseInt(res.headers.get('X-File-Size') || '0', 10);
    const serverId = res.headers.get('X-Session-Id') || '';
    const text = await res.text();
    if (!text.trim()) return;
    if (!currentSessionId && state._lastServerId && state._lastServerId !== serverId) {
      clearState(); firstBatch = true;
    }
    state._lastServerId = serverId;
    state.offset = size;
    const lines = text.trim().split('\n');
    for (const line of lines) {
      try { const evt = JSON.parse(line); state.eventSeq++; processEvent(evt); } catch {}
    }
    if (firstBatch && state.nodes.size) { firstBatch = false; _pendingFitView = true; }
    scheduleRender();
    // Swallowed on purpose, and it costs nothing now: a failed poll used to
    // have to be reported, because the watchdog ran here and had to be told
    // that the coming silence was ours and not the agent's. Detection has left
    // the tab, so a poll that did not answer means only that this round showed
    // nothing new — the next one, or the stream, will catch up.
  } catch {}
}

// ─── Sessions list ────────────────────────────────────────────────────────
export async function loadSessions() {
  try {
    const res = await fetch('/sessions');
    const sessions = await res.json();

    for (const s of sessions) {
      if (s.prompt) sessionTitles.set(s.id, s.prompt);
      if (s.agentSource) sessionAgents.set(s.id, s.agentSource);
    }
    updateTopbarPrompt();

    document.getElementById('sessions-list').innerHTML =
      `<div class="session-card${!currentSessionId ? ' active' : ''}" data-sid="">
        <div class="s-title">▶ Latest (auto)</div>
        <div class="s-meta"><span>Follows most recent session</span></div>
      </div>` +
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
  } catch {}
}

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

function formatAge(mtime) {
  const ago = Date.now() - mtime;
  if (ago < 60000) return 'just now';
  if (ago < 3600000) return `${Math.floor(ago / 60000)}m ago`;
  if (ago < 86400000) return `${Math.floor(ago / 3600000)}h ago`;
  return `${Math.floor(ago / 86400000)}d ago`;
}

// Session-card click handler — wired here since it mutates network state.
document.getElementById('sessions-list').addEventListener('click', e => {
  const card = e.target.closest('.session-card');
  if (!card) return;
  currentSessionId = card.dataset.sid || null;
  clearState();
  firstBatch = true;
  poll(true);
  loadSessions();
  // clearState() blanked the pill; an explicitly-picked session won't get a
  // live SSE `tokens` push unless it's the active one — fetch its snapshot.
  if (currentSessionId) fetchTokens(currentSessionId);
  document.getElementById('sessions-overlay').classList.remove('visible');
});

// ─── Clear / reset ────────────────────────────────────────────────────────
export function clearState() {
  state.eventSeq = 0; state.offset = 0; state.nodes.clear();
  state.selected = null; state.toolsCompleted = 0;
  state.timelineEntries = []; state.startTimes.clear();
  state._lastServerId = null;
  state.tokens.main = null;
  state.tokens.perAgent.clear();
  state.tokens.tokensSupported = null;
  state.tokens.transcriptMissing = false;
  updateBudget();
  state.forkedAgentParents.clear();
  vis.nodes.clear(); vis.particles = [];
  _feedResetHook();
  resetLayout();
  vis.drawSessionNodes.length = 0;
  vis.drawAgentNodes.length = 0;
  vis.drawToolNodes.length = 0;
  vis.drawSkillNodes.length = 0;
  vis.drawMcpNodes.length = 0;
  vis.runningNodes.clear();
  renderFeed(); updateStats();
  markNarratorDirty();
}

// UI registers a reset hook for its feed-render cursor on clearState.
let _feedResetHook = () => {};
export function setFeedResetHook(fn) { _feedResetHook = fn || (() => {}); }

export async function resetEvents() {
  clearing = true;
  const url = currentSessionId ? `/events?clear=${currentSessionId}` : '/events?clear=1';
  await fetch(url, { method: 'POST' });
  clearState();
  await loadSessions();
  clearing = false;
}

// ─── Visibility API — pause everything while tab is hidden ────────────────
let _visibilityPauseTimer = null;
let _paused = false;
function pauseApp() {
  if (_paused) return;
  _paused = true;
  if (sseSource) { sseSource.close(); sseSource = null; sseConnected = false; }
  stopPollFallback();
  // We stop listening on purpose here, and it no longer needs saying: the
  // server never stopped, so the silence that follows is ours alone and
  // nothing concludes anything from it.
  stopDurationsTicker();
  pauseTick();
  if (vis.rafHandle != null) { cancelAnimationFrame(vis.rafHandle); vis.rafHandle = null; }
  if (vis.pulseTimer != null) { clearTimeout(vis.pulseTimer); vis.pulseTimer = null; }
}
function resumeApp() {
  if (!_paused) return;
  _paused = false;
  connectSSE();
  poll(true);   // re-poll first: the file, not the gap, says what happened
  // Same reasoning for the alerts, and the same word: the journal, not the
  // gap, says what happened. Waiting for the 30s timer would not do — browsers
  // throttle the timers of a hidden tab, so on return the badge can be further
  // behind than its own period, and the stream carries only what the server
  // recorded while we were listening.
  refreshAlerts();
  resumeTick();
  markDirty();
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    if (_visibilityPauseTimer == null) {
      _visibilityPauseTimer = setTimeout(() => { _visibilityPauseTimer = null; pauseApp(); }, 2000);
    }
  } else {
    if (_visibilityPauseTimer != null) { clearTimeout(_visibilityPauseTimer); _visibilityPauseTimer = null; }
    resumeApp();
  }
});

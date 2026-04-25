// viz-network.js — SSE, poll fallback, sessions API, visibility pause.
//
// Owns the server connection (EventSource + poll loop), the current session
// selection, and the pause/resume lifecycle. Events come in here, are handed
// to viz-layout (processEvent, layout), and trigger viz-ui (renderFeed,
// updateStats, fitView) via `scheduleRender` which coalesces bursts.

import { state, vis, markDirty, esc } from './viz-state.js';
import { processEvent, layout, resetLayout } from './viz-layout.js';
import {
  renderFeed, updateStats, fitView, startDurationsTicker, stopDurationsTicker,
} from './viz-ui.js';

// ─── DOM refs ─────────────────────────────────────────────────────────────
const connDot = document.getElementById('connection-dot');

// ─── Session selection (owned here, read-only from elsewhere) ─────────────
export let currentSessionId = null;
export const sessionTitles = new Map();

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
    connDot.classList.add('connected');
    connDot.title = 'Connected';
    stopPollFallback();
  };
  sseSource.onerror = () => {
    sseConnected = false;
    connDot.classList.remove('connected');
    connDot.title = 'Disconnected';
    startPollFallback();
  };
  sseSource.onmessage = (msg) => {
    try {
      const data = JSON.parse(msg.data);
      if (data.type === 'sessionsChanged') {
        loadSessions();
        return;
      }
      if (data.type === 'tokens') {
        const target = currentSessionId || state._lastServerId;
        if (!target || data.session === target) {
          state.tokens.main = data.main || null;
          state.tokens.perAgent.clear();
          if (data.perAgent) {
            for (const [aid, bucket] of Object.entries(data.perAgent)) {
              state.tokens.perAgent.set(aid, bucket);
            }
          }
          markDirty();
        }
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
  } catch {}
}

// ─── Sessions list ────────────────────────────────────────────────────────
export async function loadSessions() {
  try {
    const res = await fetch('/sessions');
    const sessions = await res.json();

    for (const s of sessions) {
      if (s.prompt) sessionTitles.set(s.id, s.prompt);
    }
    updateTopbarPrompt();

    document.getElementById('sessions-list').innerHTML =
      `<div class="session-card${!currentSessionId ? ' active' : ''}" data-sid="">
        <div class="s-title">▶ Latest (auto)</div>
        <div class="s-meta"><span>Follows most recent session</span></div>
      </div>` +
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
  } catch {}
}

export function updateTopbarPrompt() {
  const sid = currentSessionId || state._lastServerId;
  const el = document.getElementById('topbar-prompt');
  const prompt = sid ? sessionTitles.get(sid) : null;
  el.textContent = prompt || '';
  el.title = prompt || '';
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
  document.getElementById('sessions-overlay').classList.remove('visible');
});

// ─── Clear / reset ────────────────────────────────────────────────────────
export function clearState() {
  state.eventSeq = 0; state.offset = 0; state.nodes.clear();
  state.selected = null; state.toolsCompleted = 0;
  state.timelineEntries = []; state.startTimes.clear();
  state._lastServerId = null;
  state.tokens.main = null; state.tokens.perAgent.clear();
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
}

// UI registers a reset hook for its feed-render cursor on clearState.
let _feedResetHook = () => {};
export function setFeedResetHook(fn) { _feedResetHook = fn || (() => {}); }

export async function resetEvents() {
  clearing = true;
  if (currentSessionId) await fetch(`/events?clear=${currentSessionId}`);
  else await fetch('/events?clear=1');
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
  stopDurationsTicker();
  if (vis.rafHandle != null) { cancelAnimationFrame(vis.rafHandle); vis.rafHandle = null; }
  if (vis.pulseTimer != null) { clearTimeout(vis.pulseTimer); vis.pulseTimer = null; }
}
function resumeApp() {
  if (!_paused) return;
  _paused = false;
  connectSSE();
  poll(true);
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

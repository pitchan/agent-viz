// viz-watchdog.mjs — toxic-pattern detection on the live event stream.
//
// Pure module: no DOM, no SSE, no fs. Clock is injected. Three detectors
// in a declarative table (loop / retryStorm / stuck) — adding a fourth
// (token burn, prompt injection, …) is one entry in DETECTORS.
//
// Consumers call processEvent(evt) on every incoming event and tick()
// periodically (for time-based conditions like stuck). Each call returns
// { newAlerts } — alerts that are *new* (deduplicated by signature). An
// already-active, non-acknowledged alert with the same signature won't
// re-fire; once acknowledged, it can fire again on a fresh trigger.

const DEFAULTS = {
  loop:       { windowMs: 60_000,      count: 4, bufferSize: 10 },
  retryStorm: { count: 3 },
  stuck:      { silenceMs: 3 * 60_000 },
};

function hashInput(toolInput) {
  if (toolInput === undefined || toolInput === null) return '';
  return JSON.stringify(toolInput);
}

// Per-session bookkeeping. One bucket holds the state every detector
// needs — partitioned by concern, so detectors don't step on each other.
function emptyBuffer() {
  return {
    recent: [],          // [{ ts, sig }] — last N PreToolUse signatures
    failures: new Map(), // toolName → consecutive failure count
    running: new Set(),  // set of tool_use_id currently in-flight
    lastEventAt: null,   // wall-clock ts of the last event seen for the session
  };
}

function getSessionBuffer(state, sid) {
  let buf = state.sessions.get(sid);
  if (!buf) { buf = emptyBuffer(); state.sessions.set(sid, buf); }
  return buf;
}

function makeAlert(type, sessionId, toolName, count, createdAt, message) {
  return {
    id: toolName ? `${type}:${sessionId}:${toolName}` : `${type}:${sessionId}`,
    type, sessionId, toolName, count, createdAt, message,
    acknowledged: false,
  };
}

// ─── Detectors ────────────────────────────────────────────────────────────
// Contract:
//   onEvent(ctx, evt) → Alert | null
//   onTick(ctx, now)  → Alert[]
// ctx = { state, thresholds, now: () => epochMs }
//
// Detectors are pure functions on (state, evt|now) — all mutation is
// scoped to ctx.state, which the factory owns.

const DETECTORS = {
  loop: {
    onEvent(ctx, evt) {
      if (evt.hook_event_name !== 'PreToolUse') return null;
      const sid = evt.session_id;
      if (!sid || !evt.tool_name) return null;
      const buf = getSessionBuffer(ctx.state, sid);
      const ts = ctx.now();
      const sig = `${evt.tool_name}:${hashInput(evt.tool_input)}`;
      buf.recent.push({ ts, sig });
      if (buf.recent.length > ctx.thresholds.loop.bufferSize) buf.recent.shift();
      const windowStart = ts - ctx.thresholds.loop.windowMs;
      let count = 0;
      for (const e of buf.recent) if (e.sig === sig && e.ts >= windowStart) count++;
      if (count >= ctx.thresholds.loop.count) {
        const secs = Math.round(ctx.thresholds.loop.windowMs / 1000);
        return makeAlert('loop', sid, evt.tool_name, count, ts,
          `${evt.tool_name} called ${count}× with the same input in ${secs}s`);
      }
      return null;
    },
  },

  retryStorm: {
    onEvent(ctx, evt) {
      const sid = evt.session_id;
      if (!sid || !evt.tool_name) return null;
      const buf = getSessionBuffer(ctx.state, sid);
      if (evt.hook_event_name === 'PostToolUseFailure') {
        const cur = (buf.failures.get(evt.tool_name) || 0) + 1;
        buf.failures.set(evt.tool_name, cur);
        if (cur >= ctx.thresholds.retryStorm.count) {
          return makeAlert('retryStorm', sid, evt.tool_name, cur, ctx.now(),
            `${cur} consecutive failures on ${evt.tool_name}`);
        }
      } else if (evt.hook_event_name === 'PostToolUse') {
        buf.failures.set(evt.tool_name, 0);
      }
      return null;
    },
  },

  // Stuck has two parts:
  //   - onEvent updates lastEventAt + the running-tool set (this is the
  //     book-keeping that makes "stuck" answerable).
  //   - onTick reads that state at wall-clock intervals.
  stuck: {
    onEvent(ctx, evt) {
      const sid = evt.session_id;
      if (!sid) return null;
      const buf = getSessionBuffer(ctx.state, sid);
      buf.lastEventAt = ctx.now();
      const name = evt.hook_event_name;
      if (name === 'PreToolUse' && evt.tool_use_id) {
        buf.running.add(evt.tool_use_id);
      } else if ((name === 'PostToolUse' || name === 'PostToolUseFailure') && evt.tool_use_id) {
        buf.running.delete(evt.tool_use_id);
      } else if (name === 'SessionEnd' || name === 'Stop') {
        buf.running.clear();
      }
      return null;
    },
    onTick(ctx, tickNow) {
      const alerts = [];
      for (const [sid, buf] of ctx.state.sessions) {
        if (buf.running.size === 0) continue;
        if (buf.lastEventAt == null) continue;
        const silence = tickNow - buf.lastEventAt;
        if (silence < ctx.thresholds.stuck.silenceMs) continue;
        const secs = Math.round(silence / 1000);
        alerts.push(makeAlert('stuck', sid, '', buf.running.size, tickNow,
          `No event for ${secs}s while ${buf.running.size} tool(s) still running`));
      }
      return alerts;
    },
  },
};

// ─── Factory ──────────────────────────────────────────────────────────────
// createWatchdog returns an object whose contract is the public API of the
// module. Callers should never reach into the closed-over `state`; the
// only way to drive the watchdog is through these four methods.
//
// emitIfNew implements the dedup rule: same signature already active
// (non-acknowledged) → skip. Acknowledged → replace (next trigger fires).

export function createWatchdog({ now = () => Date.now(), thresholds = DEFAULTS } = {}) {
  const state = {
    sessions: new Map(),     // sid → buffer
    activeAlerts: new Map(), // alert.id → alert
  };
  const ctx = { state, thresholds, now };

  function emitIfNew(alert) {
    if (!alert) return null;
    const existing = state.activeAlerts.get(alert.id);
    if (existing && !existing.acknowledged) return null;
    state.activeAlerts.set(alert.id, alert);
    return alert;
  }

  return {
    processEvent(evt) {
      const newAlerts = [];
      for (const det of Object.values(DETECTORS)) {
        if (typeof det.onEvent !== 'function') continue;
        const a = emitIfNew(det.onEvent(ctx, evt));
        if (a) newAlerts.push(a);
      }
      return { newAlerts };
    },
    tick() {
      const newAlerts = [];
      const tickNow = now();
      for (const det of Object.values(DETECTORS)) {
        if (typeof det.onTick !== 'function') continue;
        for (const a of det.onTick(ctx, tickNow)) {
          const emitted = emitIfNew(a);
          if (emitted) newAlerts.push(emitted);
        }
      }
      return { newAlerts };
    },
    acknowledge(alertId) {
      const a = state.activeAlerts.get(alertId);
      if (a) a.acknowledged = true;
    },
    getActiveAlerts() {
      const out = [];
      for (const a of state.activeAlerts.values()) if (!a.acknowledged) out.push(a);
      return out;
    },
  };
}

export { DEFAULTS as _DEFAULTS };

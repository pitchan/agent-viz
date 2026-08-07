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

import { toolSubject } from './viz-tool-subject.mjs';
import { clockTime } from './viz-alert-format.mjs';

const DEFAULTS = {
  loop:       { windowMs: 60_000,      count: 4, bufferSize: 10 },
  retryStorm: { count: 3 },
  stuck:      { silenceMs: 3 * 60_000, abandonedMs: 30 * 60_000 },
  // How old the *triggering* event may be for an event-driven alert to still
  // be worth raising. The browser replays a whole session file on first poll;
  // without this, every loop the session ever ran fires as if it were live.
  freshnessMs: 2 * 60_000,
};

function mergeThresholds(given) {
  return {
    loop:       { ...DEFAULTS.loop,       ...given.loop },
    retryStorm: { ...DEFAULTS.retryStorm, ...given.retryStorm },
    stuck:      { ...DEFAULTS.stuck,      ...given.stuck },
    freshnessMs: given.freshnessMs ?? DEFAULTS.freshnessMs,
  };
}

// When the event happened, as opposed to when we heard about it. The hook
// stamps `_ts` on every event it writes; anything without one is being fed to
// us live by a caller that isn't the file replay, so "now" is the honest
// answer for it.
function eventTime(evt, now) {
  const parsed = Date.parse(evt._ts);
  return Number.isFinite(parsed) ? parsed : now();
}

function hashInput(toolInput) {
  if (toolInput === undefined || toolInput === null) return '';
  return JSON.stringify(toolInput);
}

// Per-session bookkeeping. One bucket holds the state every detector
// needs — partitioned by concern, so detectors don't step on each other.
function emptyBuffer() {
  return {
    recent: [],          // [{ ts, sig, toolUseId, failed }] — last N PreToolUse
    failures: new Map(), // toolName → consecutive failure count
    running: new Map(),  // tool_use_id → in-flight tool record
    lastEventAt: null,   // event time of the last event seen for the session
    cwd: '',             // where the session runs — the panel groups by it
  };
}

function getSessionBuffer(state, sid) {
  let buf = state.sessions.get(sid);
  if (!buf) { buf = emptyBuffer(); state.sessions.set(sid, buf); }
  return buf;
}

// Who ran this call. Subagent events carry agent_id/agent_type; main-thread
// events carry neither, and '' is the honest value for "the main thread" —
// not a placeholder name the panel would have to decode.
function actor(evt) {
  return { agentId: evt.agent_id || '', agentType: evt.agent_type || '' };
}

// Every alert has the same shape, whatever raised it: `occurrences` and
// `tools` are always arrays, empty when the detector has nothing to put in
// them. A consumer can read any field of any alert without type-sniffing.
//
// The id scopes to the agent as well as the session, so two subagents looping
// at once are two alerts rather than one that names whichever fired first.
function makeAlert({
  type, sessionId, toolName = '', count, createdAt, message,
  agentId = '', agentType = '', subject = '', occurrences = [], tools = [],
  cwd = '',
}) {
  const scope = agentId ? `${sessionId}:${agentId}` : sessionId;
  return {
    id: toolName ? `${type}:${scope}:${toolName}` : `${type}:${scope}`,
    type, sessionId, toolName, count, createdAt, message,
    agentId, agentType, subject, occurrences, tools, cwd,
    acknowledged: false,
  };
}

// ─── Detectors ────────────────────────────────────────────────────────────
// Contract:
//   onEvent(ctx, evt, ts) → Alert | null   — ts = when the event happened
//   onTick(ctx, now)      → Alert[]
// ctx = { state, thresholds, now: () => epochMs }
//
// Detectors are pure functions on (state, evt|now) — all mutation is
// scoped to ctx.state, which the factory owns.
//
// Note what `ts` is *not*: it is not the moment we heard about the event.
// Every window a detector measures is measured in the event stream's own time,
// so a burst that arrives as one replayed batch keeps the shape it really had.

// What we can honestly say about a set of outcomes.
//
// A count, never a quantifier. The alert is raised ON the repeating call, so
// that call's outcome has not come back yet and — the alert being a snapshot —
// never will. "All failing" would therefore be a claim about something we have
// not seen and cannot see, in the one tool whose job is to not over-claim. A
// count with a visible denominator says exactly as much as we know: three of
// the four came back failing, and the reader can see that four were counted.
function failureSuffix(occurrences) {
  const failed = occurrences.filter(o => o.failed === true);
  if (failed.length === 0) return '';
  return ` — ${failed.length} of ${occurrences.length} failing`;
}

const DETECTORS = {
  loop: {
    onEvent(ctx, evt, ts) {
      const sid = evt.session_id;
      if (!sid || !evt.tool_name) return null;
      const buf = getSessionBuffer(ctx.state, sid);
      const name = evt.hook_event_name;
      // How a call ended is only known when it comes back. Write the outcome
      // onto the occurrence already recorded, so an alert raised later can say
      // whether what repeated was a repetition of failures.
      if (name === 'PostToolUse' || name === 'PostToolUseFailure') {
        // A human pressing Escape ends the call without telling us anything
        // about the command: the outcome stays unknown rather than becoming
        // "failed". Counting someone taking back control as a fault is the
        // exact kind of false alarm this watchdog exists to not make.
        if (evt.tool_use_id && !evt.is_interrupt) {
          for (const e of buf.recent) {
            if (e.toolUseId === evt.tool_use_id) { e.failed = name === 'PostToolUseFailure'; break; }
          }
        }
        return null;
      }
      if (name !== 'PreToolUse') return null;
      const who = actor(evt);
      // The agent is part of the signature: two subagents each calling the
      // same command twice is four calls and no loop.
      const sig = `${who.agentId}:${evt.tool_name}:${hashInput(evt.tool_input)}`;
      buf.recent.push({ ts, sig, toolUseId: evt.tool_use_id || '', failed: null });
      if (buf.recent.length > ctx.thresholds.loop.bufferSize) buf.recent.shift();
      const windowStart = ts - ctx.thresholds.loop.windowMs;
      const occurrences = [];
      for (const e of buf.recent) {
        if (e.sig === sig && e.ts >= windowStart) {
          occurrences.push({ ts: e.ts, toolUseId: e.toolUseId, failed: e.failed });
        }
      }
      if (occurrences.length >= ctx.thresholds.loop.count) {
        const spanSecs = Math.round((ts - occurrences[0].ts) / 1000);
        return makeAlert({
          type: 'loop', sessionId: sid, toolName: evt.tool_name,
          count: occurrences.length, createdAt: ts, ...who,
          subject: toolSubject(evt), occurrences, cwd: evt.cwd || '',
          message: `${evt.tool_name} called ${occurrences.length}× with the same input in ${spanSecs}s`
                 + failureSuffix(occurrences),
        });
      }
      return null;
    },
  },

  retryStorm: {
    onEvent(ctx, evt, ts) {
      const sid = evt.session_id;
      if (!sid || !evt.tool_name) return null;
      const buf = getSessionBuffer(ctx.state, sid);
      if (evt.hook_event_name === 'PostToolUseFailure') {
        const cur = (buf.failures.get(evt.tool_name) || 0) + 1;
        buf.failures.set(evt.tool_name, cur);
        if (cur >= ctx.thresholds.retryStorm.count) {
          return makeAlert({
            type: 'retryStorm', sessionId: sid, toolName: evt.tool_name,
            count: cur, createdAt: ts, ...actor(evt), subject: toolSubject(evt),
            cwd: evt.cwd || '',
            message: `${cur} consecutive failures on ${evt.tool_name}`,
          });
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
    onEvent(ctx, evt, ts) {
      const sid = evt.session_id;
      if (!sid) return null;
      const buf = getSessionBuffer(ctx.state, sid);
      buf.lastEventAt = ts;
      // onTick has no event to read: the session's project has to be kept
      // here, where events go past, or a stuck alert could not name it.
      if (evt.cwd) buf.cwd = evt.cwd;
      const name = evt.hook_event_name;
      if (name === 'PreToolUse' && evt.tool_use_id) {
        // Record enough to answer "what is it stuck on?" without going back to
        // the event stream: the panel reads this straight out of the alert.
        buf.running.set(evt.tool_use_id, {
          toolUseId: evt.tool_use_id,
          toolName: evt.tool_name || '',
          subject: toolSubject(evt),
          startedAt: ts,
          ...actor(evt),
        });
      } else if ((name === 'PostToolUse' || name === 'PostToolUseFailure') && evt.tool_use_id) {
        buf.running.delete(evt.tool_use_id);
      } else if (name === 'SessionEnd' || name === 'Stop') {
        buf.running.clear();
      }
      return null;
    },
    onTick(ctx, tickNow) {
      // Absence of events is only evidence when we would have received them.
      // The page closes the stream whenever the tab is hidden and loses it
      // whenever the server goes away; counting either as agent silence
      // invents a stall out of our own blindness.
      if (!ctx.canObserve()) return [];
      const alerts = [];
      for (const [sid, buf] of ctx.state.sessions) {
        if (buf.running.size === 0) continue;
        if (buf.lastEventAt == null) continue;
        // A band, not a threshold. Below silenceMs the tool is simply still
        // working. Past abandonedMs the session isn't stuck — it's over, and
        // saying "stuck" about a session that ended yesterday is the same lie
        // the freshness gate exists to stop.
        const silence = tickNow - buf.lastEventAt;
        if (silence < ctx.thresholds.stuck.silenceMs) continue;
        if (silence >= ctx.thresholds.stuck.abandonedMs) continue;
        alerts.push(makeAlert({
          type: 'stuck', sessionId: sid, count: buf.running.size, createdAt: tickNow,
          tools: [...buf.running.values()], cwd: buf.cwd,
          // An absolute time, never a duration. This message is written once
          // and re-read for as long as the alert lives; "for 180s" is true for
          // one second and false for every second after.
          message: `No event since ${clockTime(buf.lastEventAt)} while ${buf.running.size} tool(s) still running`,
        }));
      }
      return alerts;
    },
    // "Is this still true?" — stuck is the one condition that can un-happen
    // on its own, so it is the one that has to be able to withdraw its alert.
    isStale(ctx, alert, now) {
      // Blind means we learn nothing — neither that it is still stuck nor
      // that it recovered. Losing the sensor is not evidence the alarm
      // cleared, so the last thing we actually saw stands until we can look
      // again.
      if (!ctx.canObserve()) return false;
      const buf = ctx.state.sessions.get(alert.sessionId);
      if (!buf || buf.running.size === 0 || buf.lastEventAt == null) return true;
      const silence = now - buf.lastEventAt;
      // Below the band: the session spoke again. Above it: nobody is waiting
      // on this session any more.
      return silence < ctx.thresholds.stuck.silenceMs
          || silence >= ctx.thresholds.stuck.abandonedMs;
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

// canObserve answers "would an event have reached us just now?". It is the
// caller's business — the browser knows about its stream and its tab, this
// module does not. Defaults to true so a caller that always has the data
// (a server-side consumer, a test) needs no ceremony.
export function createWatchdog({ now = () => Date.now(), thresholds = {}, canObserve = () => true } = {}) {
  const state = {
    sessions: new Map(),     // sid → buffer
    activeAlerts: new Map(), // alert.id → alert
  };
  const ctx = { state, thresholds: mergeThresholds(thresholds), now, canObserve };

  function emitIfNew(alert) {
    if (!alert) return null;
    const existing = state.activeAlerts.get(alert.id);
    if (existing && !existing.acknowledged) return null;
    state.activeAlerts.set(alert.id, alert);
    return alert;
  }

  return {
    // The freshness gate lives here rather than inside each detector, for two
    // reasons. It is one policy, so a fourth event-driven detector inherits it
    // without knowing it exists (Open/Closed). And putting it *between*
    // book-keeping and emission is the whole point: every detector still gets
    // to see a stale event and update its state — a tool that went in flight
    // before the browser opened has to be counted — but nothing it wants to
    // say about the past reaches the user.
    processEvent(evt) {
      const ts = eventTime(evt, now);
      const fresh = (now() - ts) <= ctx.thresholds.freshnessMs;
      const newAlerts = [];
      for (const det of Object.values(DETECTORS)) {
        if (typeof det.onEvent !== 'function') continue;
        const candidate = det.onEvent(ctx, evt, ts);
        if (!fresh) continue;
        const a = emitIfNew(candidate);
        if (a) newAlerts.push(a);
      }
      return { newAlerts };
    },
    // Retire before detecting. An alert whose condition has lapsed must leave
    // the registry first, or the dedup rule would let it block the fresh alert
    // that replaces it.
    tick() {
      const newAlerts = [];
      const tickNow = now();
      for (const [id, alert] of state.activeAlerts) {
        const det = DETECTORS[alert.type];
        if (det && typeof det.isStale === 'function' && det.isStale(ctx, alert, tickNow)) {
          state.activeAlerts.delete(id);
        }
      }
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

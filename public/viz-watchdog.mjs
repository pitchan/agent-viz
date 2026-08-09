// viz-watchdog.mjs — toxic-pattern detection on the live event stream.
//
// Pure module: no DOM, no SSE, no fs. Clock is injected. Four detectors
// in a declarative table (loop / retryStorm / stuck / badInvocation) — adding
// a fifth (token burn, prompt injection, …) is one entry in DETECTORS.
//
// Consumers call processEvent(evt) on every incoming event and tick()
// periodically (for time-based conditions like stuck). Each call returns
// { newAlerts } — alerts that are *new* (deduplicated by signature). An
// already-active, non-acknowledged alert with the same signature won't
// re-fire; once acknowledged, it can fire again on a fresh trigger.

import { toolSubject } from './viz-tool-subject.mjs';
import { clockTime } from './viz-alert-format.mjs';
import { classify, PATTERNS } from './viz-invocation-patterns.mjs';

// The one filter `badInvocation` applies, derived from the table instead of
// restated here. `classify` answers WHAT a message is; only the table knows
// which of those answers points at something the user can set once and never
// meet again. Every other pattern is recognised in order to be EXCLUDED — the
// survey behind that table measured that the most frequent ones already have
// their instruction written in the tool descriptions, so repeating it would be
// advice about something nobody forgot to say.
//
// Read once, at load: the table is data and does not change under us, and a
// Set states the question this detector actually asks — membership, not order.
const WORKSTATION_SETTINGS = new Set(
  PATTERNS.filter(p => p.workstationSetting).map(p => p.id),
);

const DEFAULTS = {
  loop:       { windowMs: 60_000,      count: 4 },
  retryStorm: { count: 3 },
  stuck:      { silenceMs: 3 * 60_000, abandonedMs: 30 * 60_000 },
};

function mergeThresholds(given) {
  return {
    loop:       { ...DEFAULTS.loop,       ...given.loop },
    retryStorm: { ...DEFAULTS.retryStorm, ...given.retryStorm },
    stuck:      { ...DEFAULTS.stuck,      ...given.stuck },
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

// The failure counter is scoped to the agent as well as the tool, because the
// alert's identity is. Two subagents failing on the same tool are two storms,
// and one of them succeeding must not close the other's series — which matters
// twice over now that the counter also decides when the dedup lock is released.
function failureKey(agentId, toolName) {
  return `${agentId || ''}:${toolName}`;
}

function hashInput(toolInput) {
  if (toolInput === undefined || toolInput === null) return '';
  return JSON.stringify(toolInput);
}

// Per-session bookkeeping. One bucket holds the state every detector needs,
// partitioned by concern — with one deliberate exception: `sigOfCall` is
// written by `loop` and read by `retryStorm`, which needs to know what a
// failure was about when the failure event itself doesn't say. That read is a
// fallback and stays read-only; every other field has exactly one writer.
function emptyBuffer() {
  return {
    // Per signature, the calls still inside loop's window. A shared
    // fixed-size buffer could not do this job: ten interleaved calls from
    // another tool evicted the evidence, `loop` fell silent, and every
    // attempt to predict that silence from outside failed. Counting per
    // signature removes the thing being predicted.
    calls: new Map(),          // sig → [{ ts, toolUseId, failed }]
    sigOfCall: new Map(),      // tool_use_id → sig, for a failure with no tool_input
    failures: new Map(),       // agent:tool → consecutive failures, repeats excluded
    lastFailureSig: new Map(), // toolName → { sig, ts } of the last failure seen
    // How often this session has met a given workstation-setting pattern,
    // per actor — written and read by `badInvocation` alone. Deliberately NOT
    // reset by an acknowledgement: the detector knows nothing about acks, and
    // "the fifth time today" stays true whether or not anyone read the first.
    badInvocations: new Map(), // agent:pattern → occurrences in this session
    running: new Map(),        // tool_use_id → in-flight tool record
    lastEventAt: null,         // event time of the last event seen for the session
    cwd: '',                   // where the session runs — the panel groups by it
  };
}

// Drop what has left loop's window. Nothing is bounded by a count any more —
// only by time, which is the only bound loop's rule actually names. Both maps
// are pruned together, so neither can outlive the window it describes.
function pruneCalls(buf, windowStart) {
  for (const [sig, occ] of buf.calls) {
    while (occ.length && occ[0].ts < windowStart) {
      const gone = occ.shift();
      if (gone.toolUseId) buf.sigOfCall.delete(gone.toolUseId);
    }
    if (occ.length === 0) buf.calls.delete(sig);
  }
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
// `standing` is part of that contract. It says whether the alert reports a
// moment that has passed or a condition that still holds, which is what a
// display needs to know before deciding an alert has gone out of date. The
// detector that raises the alert is the only thing that can answer it, so it
// answers it here rather than leaving every consumer to guess from the type.
//
// `patternId` is part of it too, and empty for every detector that recognises
// no pattern. It carries the identifier of the invocation pattern and NEVER a
// fragment of the text that was matched — that distinction is what a pattern
// identifier is for. `subject`, by contrast, DOES retain text: the triggering
// command, in full, for any detector that has one to give (arbitrage doc/32
// du 2026-08-09) — the two fields answer different questions and neither
// stands in for the other.
//
// The id scopes to the agent as well as the session, so two subagents looping
// at once are two alerts rather than one that names whichever fired first.
//
// `discriminator` is what tells two alerts of the same type in the same scope
// apart. It defaults to the tool name because that is what it is for the three
// detectors that watch ONE tool — but it is not universal, and conflating the
// payload field with the identity part is what would force a fourth detector
// to lie about `toolName` to get the id it needs. `badInvocation` watches a
// workstation setting: the same setting met through two different tools is one
// setting to fix, so its discriminator is the pattern, not the tool.
function makeAlert({
  type, sessionId, toolName = '', count, createdAt, message,
  agentId = '', agentType = '', subject = '', occurrences = [], tools = [],
  cwd = '', standing = false, patternId = '', discriminator = toolName,
}) {
  const scope = agentId ? `${sessionId}:${agentId}` : sessionId;
  return {
    id: discriminator ? `${type}:${scope}:${discriminator}` : `${type}:${scope}`,
    type, sessionId, toolName, count, createdAt, message,
    agentId, agentType, subject, occurrences, tools, cwd, standing, patternId,
    acknowledged: false,
  };
}

// ─── Detectors ────────────────────────────────────────────────────────────
// Contract:
//   onEvent(ctx, evt, ts) → Alert | null   — ts = when the event happened
//   onTick(ctx, now)      → Alert[]
//   isStale(ctx, alert, now)      → bool   — optional: has the condition
//       CEASED? tick() retires the alert, taking it off the screen.
//   isPastEpisode(ctx, alert, ts) → bool   — optional: has a NEW episode
//       begun? emitIfNew releases the dedup lock so the next one can speak.
// Two questions, never one: an episode ending is not a reason to withdraw a
// report nobody has read. A detector may declare either, both, or neither.
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

// Which call a failure was about. The failure event carries `tool_input` — the
// probe's frozen sample proves it, and `toolSubject(evt)` a few lines below
// already relies on it — so the signature is computed the same way `loop`
// computes its own. `sigOfCall` is only a fallback for an event that arrived
// without it. Returns null when we cannot tell, and null is never treated as a
// repeat: not knowing what a call was is no reason to claim it repeated the
// last one.
function failureSignature(buf, evt) {
  if (evt.tool_input !== undefined) {
    return `${evt.agent_id || ''}:${evt.tool_name}:${hashInput(evt.tool_input)}`;
  }
  if (!evt.tool_use_id) return null;
  return buf.sigOfCall.get(evt.tool_use_id) ?? null;
}

const DETECTORS = {
  loop: {
    // "Has a new loop begun?" The window IS the definition of an episode: once
    // it has closed, four fresh repeats are a new loop and deserve to be told,
    // not swallowed as a duplicate of the old one.
    //
    // Something has to answer this, or the alert keeps the dedup lock for
    // ever — and since the identity is `loop:<session>:<tool>`, one alert
    // nobody acknowledged would silence that tool for the rest of the session.
    //
    // Note what this is NOT: it is not a reason to take the alert off the
    // screen. The window bounds an episode, not how long its report is worth
    // reading. Retiring on it would make a loop unacknowledgeable after sixty
    // seconds — see `isStale` on stuck for the hook that does withdraw.
    isPastEpisode(ctx, alert, ts) {
      return (ts - alert.createdAt) > ctx.thresholds.loop.windowMs;
    },
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
          const sig = buf.sigOfCall.get(evt.tool_use_id);
          const occ = sig !== undefined ? buf.calls.get(sig) : undefined;
          if (occ) {
            for (const e of occ) {
              if (e.toolUseId === evt.tool_use_id) { e.failed = name === 'PostToolUseFailure'; break; }
            }
          }
        }
        return null;
      }
      if (name !== 'PreToolUse') return null;
      const who = actor(evt);
      // The agent is part of the signature: two subagents each calling the
      // same command twice is four calls and no loop.
      const sig = `${who.agentId}:${evt.tool_name}:${hashInput(evt.tool_input)}`;
      pruneCalls(buf, ts - ctx.thresholds.loop.windowMs);
      let occ = buf.calls.get(sig);
      if (!occ) { occ = []; buf.calls.set(sig, occ); }
      const toolUseId = evt.tool_use_id || '';
      occ.push({ ts, toolUseId, failed: null });
      if (toolUseId) buf.sigOfCall.set(toolUseId, sig);
      if (occ.length >= ctx.thresholds.loop.count) {
        // A snapshot, never the live array: the alert is a photograph, and the
        // outcomes written onto `occ` after this moment must not rewrite it.
        const occurrences = occ.map(e => ({ ts: e.ts, toolUseId: e.toolUseId, failed: e.failed }));
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
    // A storm lasts exactly as long as its series, and the series is what
    // `failures` counts — a success resets it to zero. So the criterion is not
    // a duration: while the tool keeps failing it is the same storm and must
    // not be announced twice, however long it runs.
    //
    // "The counter is back to zero" states the rule but cannot be used to test
    // it. Nothing looks at the counter while it is zero: the reset happens on a
    // success, and the next question comes three failures later, by which time
    // it has climbed back to the threshold. On the event path — and in a server
    // catch-up, which has no beats at all — the zero is never seen.
    //
    // What is true at every instant is that the counter only ever climbs within
    // a series. So a counter that has not passed what this alert already
    // reported cannot be that same series still running: it was reset and
    // rebuilt, or there is nothing left to continue. Zero always satisfies it,
    // so the rule above is the special case, not something else.
    //
    // This is asked only where the counter has already climbed — on emission,
    // never on a beat. Asked on a beat it would be true the instant the alert
    // was raised (`failures` is written to `cur` just before makeAlert reads it
    // as `count`), and the storm would be retired five seconds after being
    // reported, unacknowledgeable, re-announcing itself on every later failure.
    //
    // A tool with no counter reads as a new episode — unreachable while the
    // alert exists (raising it is what set the counter, and only a success ever
    // rewrites it, to zero), and the safe direction anyway: an unknown state
    // must never hold a lock.
    isPastEpisode(ctx, alert) {
      const buf = ctx.state.sessions.get(alert.sessionId);
      if (!buf) return true;
      return (buf.failures.get(failureKey(alert.agentId, alert.toolName)) || 0) <= alert.count;
    },
    onEvent(ctx, evt, ts) {
      const sid = evt.session_id;
      if (!sid || !evt.tool_name) return null;
      const buf = getSessionBuffer(ctx.state, sid);
      if (evt.hook_event_name === 'PostToolUseFailure') {
        // A human pressing Escape is not a failure — it is someone taking
        // back control. Three interruptions in a row would otherwise raise a
        // storm alert about the user's own decisions.
        if (evt.is_interrupt) return null;
        const sig = failureSignature(buf, evt);
        const previous = buf.lastFailureSig.get(evt.tool_name);
        // Record first, decide after: the cadence must be the gap between two
        // consecutive failures, whether or not the earlier one was counted.
        buf.lastFailureSig.set(evt.tool_name, { sig, ts });
        // Re-running the SAME failing call is a loop, and `loop` says it
        // better — it names the command and counts the repeats. Counting it
        // here too would put two badges on one incident.
        //
        // But `loop` only sees a repetition that FITS IN ITS WINDOW: four
        // calls within sixty seconds. Deferring to it for a repetition it will
        // never reach means nobody is told at all — and a build that fails
        // after forty-five seconds and is retried forever is exactly the case
        // this product exists to catch. So the deference is conditional: stay
        // quiet only when the measured cadence proves `loop` will get there.
        //
        // Cadence is nearly the whole of it. `loop` now counts per signature,
        // bounded by time alone, so nothing can evict its evidence: if the
        // repetition fits in its window, it will reach its threshold. Earlier
        // rounds needed a capacity forecast only because a shared fixed-size
        // buffer could drop the proof — that failure mode went with the buffer.
        //
        // What remains is not a forecast but a fact: `loop` has to be watching
        // this signature at all. A failure can arrive whose PreToolUse we never
        // saw — the stream opened mid-flight, or the call started before the
        // page did. `tool_input` still tells us what it was, so the signature
        // is known, but `loop` holds no record of it and never will. Deferring
        // then is silence with nobody left watching.
        //
        // `sig !== null` is redundant with `buf.calls.has(sig)`: the keys of
        // `calls` are always strings, so `has(null)` is always false. It is
        // kept because it states the intent — an unknown call is never a
        // repeat — and would still hold if `calls` ever changed shape. No test
        // can cover it: no input reaches this line with sig === null and a
        // matching key, so mutating it away kills nothing. Do not add a test
        // to "close the gap" — a test that cannot fail proves nothing, which
        // is the exact fault this task spent three rounds removing.
        if (sig !== null && previous && sig === previous.sig
            && (ts - previous.ts) * (ctx.thresholds.loop.count - 1) <= ctx.thresholds.loop.windowMs
            && buf.calls.has(sig)) {
          return null;
        }
        const key = failureKey(evt.agent_id, evt.tool_name);
        const cur = (buf.failures.get(key) || 0) + 1;
        buf.failures.set(key, cur);
        if (cur >= ctx.thresholds.retryStorm.count) {
          return makeAlert({
            type: 'retryStorm', sessionId: sid, toolName: evt.tool_name,
            count: cur, createdAt: ts, ...actor(evt), subject: toolSubject(evt),
            cwd: evt.cwd || '',
            message: `${cur} consecutive failures on ${evt.tool_name}`,
          });
        }
      } else if (evt.hook_event_name === 'PostToolUse') {
        buf.failures.set(failureKey(evt.agent_id, evt.tool_name), 0);
        // The memory of the last failure goes with the counter: after a
        // success, the next failure starts a new series whatever it repeats.
        buf.lastFailureSig.delete(evt.tool_name);
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
        // "stuck" said about a session that ended yesterday is a claim about
        // the present that the present does not support.
        const silence = tickNow - buf.lastEventAt;
        if (silence < ctx.thresholds.stuck.silenceMs) continue;
        if (silence >= ctx.thresholds.stuck.abandonedMs) continue;
        alerts.push(makeAlert({
          type: 'stuck', sessionId: sid, count: buf.running.size, createdAt: tickNow,
          tools: [...buf.running.values()], cwd: buf.cwd,
          // The one condition that is still true while nothing happens, so the
          // one alert a clock must not retire. `isStale` below is what ends it.
          standing: true,
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

  // The only detector that reads the TEXT of a failure. The other three watch
  // the SHAPE of the stream — the same input four times, three failures in a
  // row, nothing at all for three minutes — and none of them can tell a build
  // that legitimately says no from a command the agent did not know how to
  // write. This one asks that second question, and only that one: did this
  // call fail because of HOW it was made?
  //
  // It is worth asking because the answer has an action attached. A Windows
  // path eaten by a POSIX shell, a cmdlet run under bash: the user sets that
  // once and never meets it again. Which is also why the filter below is the
  // ONLY one — a pattern outside `workstationSetting` is recognised so that it
  // can be left unsaid, not so that it can be reported.
  //
  // It declares neither `isStale` nor `isPastEpisode` — the safe default
  // documented at `startsNewEpisode`, and here it is the honest one twice
  // over. A failure that has happened cannot un-happen, so no clock has
  // grounds to withdraw the report; and a missing setting is one thing to fix,
  // so it deserves one alert until somebody has read it.
  badInvocation: {
    onEvent(ctx, evt, ts) {
      if (evt.hook_event_name !== 'PostToolUseFailure') return null;
      // BEFORE anything else, counter included. A human pressing Escape ends
      // the call before it could say anything about the way it was written, so
      // there is nothing here to classify and nothing to count. Same invariant
      // as `loop` and `retryStorm`: someone taking back control is not a
      // fault, and calling it one is the exact false alarm this watchdog
      // exists to not raise.
      if (evt.is_interrupt) return null;
      const sid = evt.session_id;
      if (!sid || !evt.tool_name) return null;
      // `evt.error` comes from the hook, not from us: absent, empty or not a
      // string at all are all real inputs, and `classify` is contracted to
      // answer null for each of them rather than throw into the event loop.
      const pattern = classify(evt.error);
      if (!pattern || !WORKSTATION_SETTINGS.has(pattern.id)) return null;
      const buf = getSessionBuffer(ctx.state, sid);
      // Per actor as well as per pattern, because the alert's identity is.
      // Two subagents tripping on the same setting are two facts — that is
      // what the survey actually measured: three subagents of one session,
      // minutes apart, on one shell trap.
      const key = `${evt.agent_id || ''}:${pattern.id}`;
      const count = (buf.badInvocations.get(key) || 0) + 1;
      buf.badInvocations.set(key, count);
      return makeAlert({
        type: 'badInvocation', sessionId: sid, toolName: evt.tool_name,
        count, createdAt: ts, ...actor(evt), cwd: evt.cwd || '',
        patternId: pattern.id, discriminator: pattern.id,
        // `subject` carries the triggering command, in full (arbitrage doc/32
        // du 2026-08-09, retention assumee) — the same field the other
        // detectors fill, via the same `toolSubject(evt)`. A failure without
        // its command is not fixable by the person reading the alert, and
        // that is what settled it: the pattern identifier says WHAT kind of
        // setting is missing, `subject` says WHICH command hit it. `message`
        // is the one field this detector still keeps bare — it is shared with
        // the desktop notification, which names only the motif.
        subject: toolSubject(evt),
        //
        // The count only appears once it means something: "1× this session"
        // is noise on the one line a desktop notification gets to show.
        message: `${evt.tool_name} failed on how it was called — ${pattern.id}`
               + (count > 1 ? ` (${count}× this session)` : ''),
      });
    },
  },
};

// Does the alert already in the registry still own its identity, or has a new
// episode begun? Asked of the stored alert, never of the new one, and only
// where an alert is being emitted: this releases the dedup lock, it withdraws
// nothing from the screen.
//
// Deliberately NOT the same hook as `isStale`, and the distance between them is
// the whole point. `isStale` answers "has the condition ceased?" and belongs to
// tick(), which retires. Wiring both to one predicate retired every retryStorm
// alert one beat after it was raised — its counter equals `alert.count` the
// instant it is created — leaving it unacknowledgeable and re-announcing the
// same storm on every later failure.
//
// Nor is either of them the freshness rule: that one asks "is this worth
// shouting about?" and lives at the display. A server with no display at all
// still needs this one, or a loop at 10am keeps the loop at 2pm out of the
// journal.
//
// A detector that declares neither hook keeps its alert until it is
// acknowledged — the safe default, and what loop and retryStorm did before.
function startsNewEpisode(ctx, alert, at) {
  const det = DETECTORS[alert.type];
  return !!(det && typeof det.isPastEpisode === 'function' && det.isPastEpisode(ctx, alert, at));
}

// ─── Factory ──────────────────────────────────────────────────────────────
// createWatchdog returns an object whose contract is the public API of the
// module. Callers should never reach into the closed-over `state`; the
// only way to drive the watchdog is through these four methods.
//
// emitIfNew implements the dedup rule: same signature already active
// (non-acknowledged) and still holding its identity → skip. Acknowledged, or
// superseded by a new episode → replace, and the next trigger fires.

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

  // `at` is the reference time for judging whether the alert already in the
  // registry still owns its identity — event time on the event path, wall clock
  // on the tick path. Never the moment we happen to be running: replaying a
  // file must give the same result as living through it.
  function emitIfNew(alert, at) {
    if (!alert) return null;
    const existing = state.activeAlerts.get(alert.id);
    if (existing && !existing.acknowledged && !startsNewEpisode(ctx, existing, at)) return null;
    state.activeAlerts.set(alert.id, alert);
    return alert;
  }

  return {
    // Every alert a detector raises is emitted, whatever the age of the event
    // that triggered it. This is the whole point of the journal: an incident
    // that happened while the server was down must still be recorded, with
    // the time it really happened. Deciding what is recent enough to SHOUT
    // about belongs to the display — viz-alert-freshness.mjs.
    //
    // The dedup lock is judged in the event's own time, not ours. A start-up
    // sweep replays a whole file without a single tick in between, so this is
    // the only place that can tell an episode from the one before it.
    processEvent(evt) {
      const ts = eventTime(evt, now);
      const newAlerts = [];
      for (const det of Object.values(DETECTORS)) {
        if (typeof det.onEvent !== 'function') continue;
        const a = emitIfNew(det.onEvent(ctx, evt, ts), ts);
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
      // Only what a detector says has CEASED leaves the screen. The dedup
      // lock is not consulted here: an episode being over is a reason to let
      // the next one speak, never a reason to take the report away from
      // someone who has not read it yet.
      for (const [id, alert] of state.activeAlerts) {
        const det = DETECTORS[alert.type];
        if (det && typeof det.isStale === 'function' && det.isStale(ctx, alert, tickNow)) {
          state.activeAlerts.delete(id);
        }
      }
      for (const det of Object.values(DETECTORS)) {
        if (typeof det.onTick !== 'function') continue;
        for (const a of det.onTick(ctx, tickNow)) {
          const emitted = emitIfNew(a, tickNow);
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

// The kinds of alert a DETECTOR can raise — not "every type that exists": the
// pricing vigil builds its own alerts client-side, never goes through the
// journal, and is deliberately absent from this list.
//
// It is exported so a contract can be checked on BOTH sides rather than on one.
// The Pannes panel words each of these in French from their structured fields;
// a detector added without its wording would print its type name there, which
// reads as a broken tool rather than as a failed session. A test that reads
// this list is what makes that impossible to do silently — see
// tests/unit/failures-format.test.mjs.
export const _DETECTOR_TYPES = Object.keys(DETECTORS);

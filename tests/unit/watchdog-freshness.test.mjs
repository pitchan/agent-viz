// What the removal of the freshness gate must NOT break.
//
// The gate used to live inside processEvent, and that is exactly what made the
// tool forget: an hour-old incident raised nothing, so nothing could ever be
// written down about it. It is gone from detection. The watchdog now records
// what it sees, whenever it saw it, stamped with the real time of the
// triggering event. Deciding what is recent enough to SHOW moved to
// viz-alert-freshness.mjs — see tests/unit/alert-freshness.test.mjs.
//
// What has not changed, and is what this file pins:
//
//   * Every window a detector measures is measured in the event stream's own
//     time. That, and not a recency cut, is what stops a 90s history replayed
//     in one burst from reading as a loop.
//   * Book-keeping runs on old events: a tool that went in flight before we
//     started has to count.
//   * stuck is a band, not a threshold — silent long enough to be stuck, not
//     so long that the session is simply over — it withdraws its own alert
//     when the condition lapses, and it still refuses to conclude anything
//     from a silence it could not have heard.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWatchdog } from '../../public/viz-watchdog.mjs';
import { isFresh } from '../../public/viz-alert-freshness.mjs';

const T = 1_700_000_000_000; // fixed "now" for every test

function clockAt(start = T) {
  let t = start;
  return { now: () => t, advance(ms) { t += ms; } };
}

const iso = ms => new Date(ms).toISOString();

function pre({ at, session = 'sid1', tool = 'Bash', input = { command: 'npm test' }, id = 't1' }) {
  return {
    session_id: session, hook_event_name: 'PreToolUse',
    tool_name: tool, tool_input: input, tool_use_id: id, _ts: iso(at),
  };
}
function fail({ at, session = 'sid1', tool = 'Bash', id = 't1' }) {
  return { session_id: session, hook_event_name: 'PostToolUseFailure', tool_name: tool, tool_use_id: id, _ts: iso(at) };
}

// ─── Event-triggered detectors: the record has no expiry date ──────────────

test('loop: an hour-old history replayed in one burst is still recorded', () => {
  const clock = clockAt();
  const wd = createWatchdog({ now: clock.now });
  // Four identical calls that really did happen 4× in 15s — one hour ago.
  const base = T - 60 * 60_000;
  const raised = [];
  for (let i = 0; i < 4; i++) {
    raised.push(...wd.processEvent(pre({ at: base + i * 5_000, id: `t${i}` })).newAlerts);
  }
  assert.equal(raised.length, 1, 'recording has no expiry date');
  assert.equal(raised[0].createdAt, base + 3 * 5_000,
    'the time it carries is the event, never the moment we heard about it');
});

test('loop: the window is measured on event time, not arrival time', () => {
  const clock = clockAt();
  const wd = createWatchdog({ now: clock.now });
  // Four identical calls spread over 90s of *event* time, all arriving in the
  // same millisecond (a replay). 90s > the 60s window → at most 3 in window.
  for (let i = 0; i < 4; i++) wd.processEvent(pre({ at: T - 90_000 + i * 30_000, id: `t${i}` }));
  assert.deepEqual(wd.getActiveAlerts(), [], 'spread beyond the window is not a loop, however it arrives');
});

test('loop: four fresh identical calls inside the window still alert', () => {
  const clock = clockAt();
  const wd = createWatchdog({ now: clock.now });
  let last = [];
  for (let i = 0; i < 4; i++) last = wd.processEvent(pre({ at: T - 15_000 + i * 5_000, id: `t${i}` })).newAlerts;
  assert.equal(last.length, 1);
  assert.equal(last[0].type, 'loop');
  assert.equal(last[0].count, 4);
});

test('retryStorm: three failures replayed from an old file are recorded too', () => {
  const clock = clockAt();
  const wd = createWatchdog({ now: clock.now });
  const base = T - 60 * 60_000;
  const raised = [];
  for (let i = 0; i < 3; i++) {
    raised.push(...wd.processEvent(fail({ at: base + i * 1_000, id: `t${i}` })).newAlerts);
  }
  assert.equal(raised.length, 1, 'a storm nobody was watching is still a storm');
  assert.equal(raised[0].createdAt, base + 2_000, 'stamped with the event time, not ours');
});

// ─── Book-keeping runs on every event, old or new ──────────────────────────

test('retryStorm: stale failures still count — a fresh third failure alerts', () => {
  const clock = clockAt();
  const wd = createWatchdog({ now: clock.now });
  // Two failures from the replayed history, then one happening right now.
  wd.processEvent(fail({ at: T - 60 * 60_000, id: 'a' }));
  wd.processEvent(fail({ at: T - 59 * 60_000, id: 'b' }));
  const r = wd.processEvent(fail({ at: T, id: 'c' }));
  assert.equal(r.newAlerts.length, 1, 'the counter must span the replayed history');
  assert.equal(r.newAlerts[0].count, 3);
});

test('stuck: a tool that went in flight before the page opened is still seen', () => {
  const clock = clockAt();
  const wd = createWatchdog({ now: clock.now });
  // Replayed PreToolUse, 10 minutes old, never closed. Book-keeping has to
  // run on it or the tool would not be known to be in flight at all.
  wd.processEvent(pre({ at: T - 10 * 60_000, id: 't1' }));
  const r = wd.tick();
  assert.equal(r.newAlerts.length, 1, 'ten minutes in flight is exactly what stuck means');
  assert.equal(r.newAlerts[0].type, 'stuck');
});

// ─── Stuck: a band, not a recency gate ─────────────────────────────────────

test('stuck: a session silent for two hours is over, not stuck', () => {
  const clock = clockAt();
  const wd = createWatchdog({ now: clock.now });
  wd.processEvent(pre({ at: T - 2 * 60 * 60_000, id: 't1' }));
  assert.deepEqual(wd.tick().newAlerts, [], 'past the abandoned horizon nothing is actionable');
});

test('stuck: silence is measured from the event timestamp, not from arrival', () => {
  const clock = clockAt();
  const wd = createWatchdog({ now: clock.now });
  // Arrives now, but says it happened 4 minutes ago → already stuck.
  const silentSince = T - 4 * 60_000;
  wd.processEvent(pre({ at: silentSince, id: 't1' }));
  const r = wd.tick();
  assert.equal(r.newAlerts.length, 1);
  const wall = new Date(silentSince).toTimeString().slice(0, 8);
  assert.ok(r.newAlerts[0].message.includes(wall),
    `the message must point at the real last event (${wall}), got: ${r.newAlerts[0].message}`);
});

test('stuck: the message states an absolute time, so it cannot rot on screen', () => {
  const clock = clockAt();
  const wd = createWatchdog({ now: clock.now });
  wd.processEvent(pre({ at: T - 4 * 60_000, id: 't1' }));
  const message = wd.tick().newAlerts[0].message;
  // A baked "for 240s" is true for one second and a lie for every second
  // after: the panel never rewrites it.
  assert.doesNotMatch(message, /\bfor \d+s\b/, 'no frozen duration in a message that outlives its tick');
});

// ─── Retirement ────────────────────────────────────────────────────────────
// An alert is a claim about the present, and stuck is the one condition that
// can un-happen on its own. Recording it is not enough: it has to be able to
// take it back once the session speaks again, or goes past being worth
// reporting at all.

test('stuck: the alert is retired once the session passes the abandoned horizon', () => {
  const clock = clockAt();
  const wd = createWatchdog({ now: clock.now });
  wd.processEvent(pre({ at: T - 4 * 60_000, id: 't1' }));
  assert.equal(wd.tick().newAlerts.length, 1);
  assert.equal(wd.getActiveAlerts().length, 1);

  clock.advance(30 * 60_000); // silence now well past abandonedMs
  wd.tick();
  assert.deepEqual(wd.getActiveAlerts(), [],
    'a session nobody is waiting on any more must stop claiming to be stuck');
});

test('stuck: the alert survives while the session stays inside the band', () => {
  const clock = clockAt();
  const wd = createWatchdog({ now: clock.now });
  wd.processEvent(pre({ at: T - 4 * 60_000, id: 't1' }));
  wd.tick();
  clock.advance(60_000); // 5 minutes of silence — still stuck
  wd.tick();
  assert.equal(wd.getActiveAlerts().length, 1);
});

test('stuck: the alert is retired when the last in-flight tool completes', () => {
  const clock = clockAt();
  const wd = createWatchdog({ now: clock.now });
  wd.processEvent(pre({ at: T - 4 * 60_000, id: 't1' }));
  wd.tick();
  assert.equal(wd.getActiveAlerts().length, 1);

  wd.processEvent({
    session_id: 'sid1', hook_event_name: 'PostToolUse',
    tool_name: 'Bash', tool_use_id: 't1', _ts: iso(T),
  });
  wd.tick();
  assert.deepEqual(wd.getActiveAlerts(), [], 'the tool came back — there is nothing to report');
});

test('stuck: a retired alert can fire again if the session gets stuck anew', () => {
  const clock = clockAt();
  const wd = createWatchdog({ now: clock.now });
  wd.processEvent(pre({ at: T - 4 * 60_000, id: 't1' }));
  wd.tick();
  wd.processEvent({
    session_id: 'sid1', hook_event_name: 'PostToolUse',
    tool_name: 'Bash', tool_use_id: 't1', _ts: iso(T),
  });
  wd.tick();
  // A new tool goes in flight and the session falls silent again.
  wd.processEvent(pre({ at: T, id: 't2' }));
  clock.advance(4 * 60_000);
  assert.equal(wd.tick().newAlerts.length, 1, 'retirement must not be mistaken for acknowledgement');
});

// ─── Blindness is not silence ──────────────────────────────────────────────
// stuck is the one detector that concludes from an *absence* of events, which
// makes it the one that cannot tell "the agent stopped" from "we stopped
// being able to hear it". The browser closes the stream on purpose whenever
// the tab is hidden, and loses it whenever the server goes away — attributing
// either to the agent invents a stall that never happened.

test('stuck: no alert is raised while the observer cannot see', () => {
  const clock = clockAt();
  const wd = createWatchdog({ now: clock.now, canObserve: () => false });
  wd.processEvent(pre({ at: T - 4 * 60_000, id: 't1' }));
  assert.deepEqual(wd.tick().newAlerts, [],
    'silence we caused ourselves says nothing about the agent');
});

test('stuck: an alert raised while watching is kept, not retracted, once blind', () => {
  const clock = clockAt();
  let sighted = true;
  const wd = createWatchdog({ now: clock.now, canObserve: () => sighted });
  wd.processEvent(pre({ at: T - 4 * 60_000, id: 't1' }));
  assert.equal(wd.tick().newAlerts.length, 1);

  sighted = false;
  clock.advance(60 * 60_000); // an hour blind, well past the abandoned horizon
  wd.tick();
  assert.equal(wd.getActiveAlerts().length, 1,
    'losing the sensor is not evidence the alarm cleared');
});

test('stuck: judgment resumes when sight returns', () => {
  const clock = clockAt();
  let sighted = false;
  const wd = createWatchdog({ now: clock.now, canObserve: () => sighted });
  wd.processEvent(pre({ at: T - 4 * 60_000, id: 't1' }));
  assert.deepEqual(wd.tick().newAlerts, []);
  sighted = true;
  assert.equal(wd.tick().newAlerts.length, 1);
});

test('loop still fires while blind — it judges events, never their absence', () => {
  const clock = clockAt();
  const wd = createWatchdog({ now: clock.now, canObserve: () => false });
  let last = [];
  for (let i = 0; i < 4; i++) last = wd.processEvent(pre({ at: T - 15_000 + i * 5_000, id: `t${i}` })).newAlerts;
  assert.equal(last.length, 1, 'an event in hand is proof regardless of the channel');
});

// ─── standing: a state does not go out of date ─────────────────────────────
// Moving freshness to the display gave the badge a two-minute expiry it never
// had. For an event-driven alert that is right — it reports something that is
// over. For stuck it would be a lie: createdAt is frozen by the dedup rule, so
// at minute five of a session that is still frozen the watchdog says stuck and
// the badge says nothing. The alert declares which kind it is; the display
// reads the flag and never the type.
//
// These go through a REAL detector on purpose. Exercising the flag against
// isFresh alone would pin the rule and leave the detector free to never set it.

test('stuck: the detector marks its alert standing, and the display cut spares it', () => {
  const clock = clockAt();
  const wd = createWatchdog({ now: clock.now });
  wd.processEvent(pre({ at: T - 4 * 60_000, id: 't1' }));
  const alert = wd.tick().newAlerts[0];
  assert.equal(alert.standing, true, 'the display reads a flag, it cannot guess the type');

  clock.advance(10 * 60_000);   // nothing happened, nobody acknowledged
  wd.tick();                    // and the watchdog has looked again since
  assert.equal(wd.getActiveAlerts().length, 1, 'the watchdog still judges the session stuck');
  assert.equal(isFresh(alert, clock.now()), true, 'so the badge has to keep saying so');
});

test('loop: an event-driven alert is not standing, and does go out of date', () => {
  const clock = clockAt();
  const wd = createWatchdog({ now: clock.now });
  let last = [];
  for (let i = 0; i < 4; i++) {
    last = wd.processEvent(pre({ at: T - 15_000 + i * 5_000, id: `t${i}` })).newAlerts;
  }
  const alert = last[0];
  assert.equal(alert.standing, false, 'something that is over is not a standing condition');
  assert.equal(isFresh(alert, alert.createdAt), true, 'news while it is news');
  assert.equal(isFresh(alert, alert.createdAt + 2 * 60_000 + 1), false, 'history two minutes later');
});

test('stuck: standing is not immortal — the detector still takes its alert back', () => {
  const clock = clockAt();
  const wd = createWatchdog({ now: clock.now });
  wd.processEvent(pre({ at: T - 4 * 60_000, id: 't1' }));
  const alert = wd.tick().newAlerts[0];
  // The tool comes back, so the condition is over. Freshness would hold on to
  // this alert for ever — the withdrawal can only come from the detector.
  wd.processEvent({
    session_id: 'sid1', hook_event_name: 'PostToolUse',
    tool_name: 'Bash', tool_use_id: 't1', _ts: iso(T),
  });
  wd.tick();
  clock.advance(10 * 60_000);
  assert.equal(isFresh(alert, clock.now()), true, 'the clock alone will never drop it');
  assert.deepEqual(wd.getActiveAlerts().filter(a => isFresh(a, clock.now())), [],
    'and still nothing is shown: what stands has to be able to stop standing');
});

// ─── The dedup registry is not the display ─────────────────────────────────
// The gate used to sit BETWEEN book-keeping and emission, so it also kept a
// stale alert out of `activeAlerts`. Without it, an alert the display filters
// away still holds the dedup lock — and since the identity is
// `loop:<session>:<tool>` with no entry in it, one ghost silences that tool for
// the rest of the session, unacknowledgeably (the button only exists for what
// the display renders).
//
// The answer is not to put freshness back into detection: "should we shout?"
// and "is this still the same incident?" are different questions. The second
// already has its mechanism — `isStale` — and each detector answers it from
// its own definition.

test('loop: un episode clos ne verrouille pas le suivant', () => {
  const clock = clockAt();
  const wd = createWatchdog({ now: clock.now });
  let first = [];
  for (let i = 0; i < 4; i++) {
    first = wd.processEvent(pre({ at: T - 15_000 + i * 5_000, id: `a${i}` })).newAlerts;
  }
  assert.equal(first.length, 1);

  clock.advance(5 * 60_000);
  wd.tick();
  const at = clock.now();
  let second = [];
  for (let i = 0; i < 4; i++) {
    second = wd.processEvent(pre({ at: at + i * 5_000, id: `b${i}` })).newAlerts;
  }
  assert.equal(second.length, 1, 'the same tool looping again later is a new incident');
  assert.notEqual(second[0].createdAt, first[0].createdAt);
});

test('loop: deux episodes du meme rattrapage entrent tous les deux', () => {
  // The server's start-up sweep replays a whole file with no tick in between.
  // Retiring on tick alone would not save the afternoon episode: the lock has
  // to break on the emission path too, or the journal keeps only the first.
  const wd = createWatchdog({ now: () => T + 5 * 3_600_000 });
  const morning = T;
  const afternoon = T + 4 * 3_600_000;
  const raised = [];
  for (const base of [morning, afternoon]) {
    for (let i = 0; i < 4; i++) {
      raised.push(...wd.processEvent(pre({ at: base + i * 5_000, id: `${base}-${i}` })).newAlerts);
    }
  }
  assert.equal(raised.length, 2, 'four hours apart is two incidents, and no tick came between');
  assert.deepEqual(raised.map(a => a.createdAt), [morning + 15_000, afternoon + 15_000]);
});

test('loop: dans la meme fenetre, c est toujours le meme incident', () => {
  // The negative control — breaking the lock must not turn one runaway into a
  // new alert every few calls — and the reason the lock is judged in the event
  // stream's own time. These eight calls really did happen inside half a
  // minute; replaying them an hour later must not split them into five
  // incidents because OUR clock has moved on since.
  const wd = createWatchdog({ now: () => T + 3_600_000 });
  const raised = [];
  for (let i = 0; i < 8; i++) {
    raised.push(...wd.processEvent(pre({ at: T - 30_000 + i * 4_000, id: `t${i}` })).newAlerts);
  }
  assert.equal(raised.length, 1, 'eight calls inside half a minute are one loop, not five');
});

test('retryStorm: tant que ca echoue, c est le meme orage', () => {
  const clock = clockAt();
  const wd = createWatchdog({ now: clock.now });
  const raised = [];
  for (let i = 0; i < 6; i++) {
    raised.push(...wd.processEvent(fail({ at: T + i * 1_000, id: `x${i}` })).newAlerts);
  }
  assert.equal(raised.length, 1, 'six failures with nothing succeeding in between are one storm');
});

test('retryStorm: un succes clot l orage, la serie suivante sonne de nouveau', () => {
  const clock = clockAt();
  const wd = createWatchdog({ now: clock.now });
  const raised = [];
  for (let i = 0; i < 3; i++) raised.push(...wd.processEvent(fail({ at: T + i * 1_000, id: `x${i}` })).newAlerts);
  assert.equal(raised.length, 1, 'three consecutive failures are a storm');

  wd.processEvent({
    session_id: 'sid1', hook_event_name: 'PostToolUse',
    tool_name: 'Bash', tool_use_id: 'ok', _ts: iso(T + 4_000),
  });
  for (let i = 0; i < 3; i++) {
    raised.push(...wd.processEvent(fail({ at: T + 10_000 + i * 1_000, id: `y${i}` })).newAlerts);
  }
  assert.equal(raised.length, 2, 'a series that starts after a success is a new storm');
});

// ─── Thresholds ────────────────────────────────────────────────────────────

test('partial thresholds merge over the defaults', () => {
  const clock = clockAt();
  const wd = createWatchdog({ now: clock.now, thresholds: { loop: { count: 2 } } });
  wd.processEvent(pre({ at: T - 5_000, id: 't1' }));
  const r = wd.processEvent(pre({ at: T, id: 't2' }));
  assert.equal(r.newAlerts.length, 1, 'the overridden count applies');
  assert.equal(r.newAlerts[0].count, 2, 'and windowMs kept its default');
});

test('abandonedMs is configurable', () => {
  const clock = clockAt();
  const wd = createWatchdog({ now: clock.now, thresholds: { stuck: { abandonedMs: 3 * 60 * 60_000 } } });
  wd.processEvent(pre({ at: T - 2 * 60 * 60_000, id: 't1' }));
  assert.equal(wd.tick().newAlerts.length, 1, 'a three-hour horizon still calls two hours stuck');
});

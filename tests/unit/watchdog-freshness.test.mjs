// Unit tests for the watchdog's freshness rule.
//
// Why this file exists: the browser replays a session's whole event file on
// the first poll. The watchdog used to stamp every event with wall-clock
// now(), so an hour-old history collapsed into one instant and any four
// identical calls the session had ever made looked like a live loop. Every
// alert about the past is a lie.
//
// The rule has two halves, and they are NOT the same rule — that is the trap:
//
//   * Event-triggered detectors (loop, retryStorm) fire because something just
//     happened. Gate them on the age of the triggering event: too old → silent.
//   * The stuck detector fires *because of* silence. The same gate would make
//     it unfireable — three minutes of silence is, by construction, an event
//     three minutes old. It needs a band instead: silent long enough to be
//     stuck, not so long that the session is simply over.
//
// And in both halves the gate applies to *emission only*. Book-keeping must
// still run on old events, or a session whose tool went in flight before you
// opened the browser would be invisible.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWatchdog } from '../../public/viz-watchdog.mjs';

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

// ─── Event-triggered detectors: gated on the age of the trigger ────────────

test('loop: an hour-old history replayed in one burst raises nothing', () => {
  const clock = clockAt();
  const wd = createWatchdog({ now: clock.now });
  // Four identical calls that really did happen 4× in 15s — one hour ago.
  const base = T - 60 * 60_000;
  for (let i = 0; i < 4; i++) wd.processEvent(pre({ at: base + i * 5_000, id: `t${i}` }));
  assert.deepEqual(wd.getActiveAlerts(), [], 'a loop that ended an hour ago is not news');
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

test('retryStorm: three failures replayed from an old file raise nothing', () => {
  const clock = clockAt();
  const wd = createWatchdog({ now: clock.now });
  const base = T - 60 * 60_000;
  for (let i = 0; i < 3; i++) wd.processEvent(fail({ at: base + i * 1_000, id: `t${i}` }));
  assert.deepEqual(wd.getActiveAlerts(), []);
});

// ─── The gate is on emission, never on book-keeping ────────────────────────

test('retryStorm: stale failures still count — a fresh third failure alerts', () => {
  const clock = clockAt();
  const wd = createWatchdog({ now: clock.now });
  // Two failures from the replayed history, then one happening right now.
  wd.processEvent(fail({ at: T - 60 * 60_000, id: 'a' }));
  wd.processEvent(fail({ at: T - 59 * 60_000, id: 'b' }));
  const r = wd.processEvent(fail({ at: T, id: 'c' }));
  assert.equal(r.newAlerts.length, 1, 'the counter must have survived the freshness gate');
  assert.equal(r.newAlerts[0].count, 3);
});

test('stuck: a tool that went in flight before the page opened is still seen', () => {
  const clock = clockAt();
  const wd = createWatchdog({ now: clock.now });
  // Replayed PreToolUse, 10 minutes old, never closed. Older than the
  // freshness gate — book-keeping must run anyway.
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

// ─── Retirement: the half the creation gate cannot cover ───────────────────
// An alert is a claim about the present. Gating creation keeps false claims
// out; nothing was retracting the ones that went false *after* being raised.

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

// ─── Thresholds ────────────────────────────────────────────────────────────

test('partial thresholds merge over the defaults', () => {
  const clock = clockAt();
  const wd = createWatchdog({ now: clock.now, thresholds: { loop: { count: 2 } } });
  wd.processEvent(pre({ at: T - 5_000, id: 't1' }));
  const r = wd.processEvent(pre({ at: T, id: 't2' }));
  assert.equal(r.newAlerts.length, 1, 'the overridden count applies');
  assert.equal(r.newAlerts[0].count, 2, 'and windowMs kept its default');
});

test('freshnessMs is configurable', () => {
  const clock = clockAt();
  const wd = createWatchdog({ now: clock.now, thresholds: { freshnessMs: 2 * 60 * 60_000 } });
  const base = T - 60 * 60_000;
  for (let i = 0; i < 4; i++) wd.processEvent(pre({ at: base + i * 5_000, id: `t${i}` }));
  assert.equal(wd.getActiveAlerts().length, 1, 'a two-hour freshness window admits an hour-old loop');
});

test('abandonedMs is configurable', () => {
  const clock = clockAt();
  const wd = createWatchdog({ now: clock.now, thresholds: { stuck: { abandonedMs: 3 * 60 * 60_000 } } });
  wd.processEvent(pre({ at: T - 2 * 60 * 60_000, id: 't1' }));
  assert.equal(wd.tick().newAlerts.length, 1, 'a three-hour horizon still calls two hours stuck');
});

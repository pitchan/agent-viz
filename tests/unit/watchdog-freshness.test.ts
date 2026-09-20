// What detection must keep doing with no freshness gate inside it.
//
// A recency gate in processEvent would make the tool forget: an hour-old incident
// would raise nothing, so nothing could ever be written down about it.
//
// The watchdog records what it sees, whenever it saw it, stamped with the real time
// of the triggering event. Deciding what is recent enough to SHOW belongs to
// src/web/viz-alert-freshness.ts — see tests/unit/alert-freshness.test.mjs.
//
// What this file pins:
//
//   * Every window a detector measures is measured in the event stream's own
//     time. That, and not a recency cut, is what stops a 90s history replayed
//     in one burst from reading as a loop.
//   * Book-keeping runs on old events: a tool that went in flight before we
//     started has to count.
//   * stuck is a band, not a threshold — silent long enough to be stuck, not
//     so long that the session is simply over — it withdraws its own alert
//     when the condition lapses, and it refuses to conclude anything
//     from a silence it could not have heard.

import { expect, test } from 'vitest';
import { createWatchdog, type Alert } from '../../src/engine/watchdog/detector.ts';
import { isFresh } from '../../src/web/viz-alert-freshness.ts';

const T = 1_700_000_000_000; // fixed "now" for every test

function clockAt(start = T) {
  let t = start;
  return { now: () => t, advance(ms: number) { t += ms; } };
}

const iso = (ms: number) => new Date(ms).toISOString();

function pre({ at, session = 'sid1', tool = 'Bash', input = { command: 'npm test' }, id = 't1' }: {
  at: number; session?: string; tool?: string; input?: Record<string, string>; id?: string;
}) {
  return {
    session_id: session, hook_event_name: 'PreToolUse',
    tool_name: tool, tool_input: input, tool_use_id: id, _ts: iso(at),
  };
}
function fail({ at, session = 'sid1', tool = 'Bash', id = 't1' }: {
  at: number; session?: string; tool?: string; id?: string;
}) {
  return { session_id: session, hook_event_name: 'PostToolUseFailure', tool_name: tool, tool_use_id: id, _ts: iso(at) };
}

// ─── Event-triggered detectors: the record has no expiry date ──────────────

test('loop: an hour-old history replayed in one burst is still recorded', () => {
  const clock = clockAt();
  const wd = createWatchdog({ now: clock.now });
  // Four identical calls that really did happen 4× in 15s — one hour ago.
  const base = T - 60 * 60_000;
  const raised: Alert[] = [];
  for (let i = 0; i < 4; i++) {
    raised.push(...wd.processEvent(pre({ at: base + i * 5_000, id: `t${i}` })).newAlerts);
  }
  expect(raised.length, 'recording has no expiry date').toBe(1);
  expect(raised[0]!.createdAt, 'the time it carries is the event, never the moment we heard about it').toBe(base + 3 * 5_000);
});

test('loop: the window is measured on event time, not arrival time', () => {
  const clock = clockAt();
  const wd = createWatchdog({ now: clock.now });
  // Four identical calls spread over 90s of *event* time, all arriving in the
  // same millisecond (a replay). 90s > the 60s window → at most 3 in window.
  for (let i = 0; i < 4; i++) wd.processEvent(pre({ at: T - 90_000 + i * 30_000, id: `t${i}` }));
  expect(wd.getActiveAlerts(), 'spread beyond the window is not a loop, however it arrives').toEqual([]);
});

test('loop: four fresh identical calls inside the window still alert', () => {
  const clock = clockAt();
  const wd = createWatchdog({ now: clock.now });
  let last: Alert[] = [];
  for (let i = 0; i < 4; i++) last = wd.processEvent(pre({ at: T - 15_000 + i * 5_000, id: `t${i}` })).newAlerts;
  expect(last.length).toBe(1);
  expect(last[0]!.type).toBe('loop');
  expect(last[0]!.count).toBe(4);
});

test('retryStorm: three failures replayed from an old file are recorded too', () => {
  const clock = clockAt();
  const wd = createWatchdog({ now: clock.now });
  const base = T - 60 * 60_000;
  const raised: Alert[] = [];
  for (let i = 0; i < 3; i++) {
    raised.push(...wd.processEvent(fail({ at: base + i * 1_000, id: `t${i}` })).newAlerts);
  }
  expect(raised.length, 'a storm nobody was watching is still a storm').toBe(1);
  expect(raised[0]!.createdAt, 'stamped with the event time, not ours').toBe(base + 2_000);
});

// ─── Book-keeping runs on every event, old or new ──────────────────────────

test('retryStorm: stale failures still count — a fresh third failure alerts', () => {
  const clock = clockAt();
  const wd = createWatchdog({ now: clock.now });
  // Two failures from the replayed history, then one happening right now.
  wd.processEvent(fail({ at: T - 60 * 60_000, id: 'a' }));
  wd.processEvent(fail({ at: T - 59 * 60_000, id: 'b' }));
  const r = wd.processEvent(fail({ at: T, id: 'c' }));
  expect(r.newAlerts.length, 'the counter must span the replayed history').toBe(1);
  expect(r.newAlerts[0]!.count).toBe(3);
});

test('stuck: a tool that went in flight before the page opened is still seen', () => {
  const clock = clockAt();
  const wd = createWatchdog({ now: clock.now });
  // Replayed PreToolUse, 10 minutes old, never closed. Book-keeping has to
  // run on it or the tool would not be known to be in flight at all.
  wd.processEvent(pre({ at: T - 10 * 60_000, id: 't1' }));
  const r = wd.tick();
  expect(r.newAlerts.length, 'ten minutes in flight is exactly what stuck means').toBe(1);
  expect(r.newAlerts[0]!.type).toBe('stuck');
});

// ─── Stuck: a band, not a recency gate ─────────────────────────────────────

test('stuck: a session silent for two hours is over, not stuck', () => {
  const clock = clockAt();
  const wd = createWatchdog({ now: clock.now });
  wd.processEvent(pre({ at: T - 2 * 60 * 60_000, id: 't1' }));
  expect(wd.tick().newAlerts, 'past the abandoned horizon nothing is actionable').toEqual([]);
});

test('stuck: silence is measured from the event timestamp, not from arrival', () => {
  const clock = clockAt();
  const wd = createWatchdog({ now: clock.now });
  // Arrives now, but says it happened 4 minutes ago → already stuck.
  const silentSince = T - 4 * 60_000;
  wd.processEvent(pre({ at: silentSince, id: 't1' }));
  const r = wd.tick();
  expect(r.newAlerts.length).toBe(1);
  const wall = new Date(silentSince).toTimeString().slice(0, 8);
  expect(r.newAlerts[0]!.message.includes(wall), `the message must point at the real last event (${wall}), got: ${r.newAlerts[0]!.message}`).toBeTruthy();
});

test('stuck: the message states an absolute time, so it cannot rot on screen', () => {
  const clock = clockAt();
  const wd = createWatchdog({ now: clock.now });
  wd.processEvent(pre({ at: T - 4 * 60_000, id: 't1' }));
  const message = wd.tick().newAlerts[0]!.message;
  // A baked "for 240s" is true for one second and a lie for every second
  // after: the panel never rewrites it.
  expect(message, 'no frozen duration in a message that outlives its tick').not.toMatch(/\bfor \d+s\b/);
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
  expect(wd.tick().newAlerts.length).toBe(1);
  expect(wd.getActiveAlerts().length).toBe(1);

  clock.advance(30 * 60_000); // silence now well past abandonedMs
  wd.tick();
  expect(wd.getActiveAlerts(), 'a session nobody is waiting on any more must stop claiming to be stuck').toEqual([]);
});

test('stuck: the alert survives while the session stays inside the band', () => {
  const clock = clockAt();
  const wd = createWatchdog({ now: clock.now });
  wd.processEvent(pre({ at: T - 4 * 60_000, id: 't1' }));
  wd.tick();
  clock.advance(60_000); // 5 minutes of silence — still stuck
  wd.tick();
  expect(wd.getActiveAlerts().length).toBe(1);
});

test('stuck: the alert is retired when the last in-flight tool completes', () => {
  const clock = clockAt();
  const wd = createWatchdog({ now: clock.now });
  wd.processEvent(pre({ at: T - 4 * 60_000, id: 't1' }));
  wd.tick();
  expect(wd.getActiveAlerts().length).toBe(1);

  wd.processEvent({
    session_id: 'sid1', hook_event_name: 'PostToolUse',
    tool_name: 'Bash', tool_use_id: 't1', _ts: iso(T),
  });
  wd.tick();
  expect(wd.getActiveAlerts(), 'the tool came back — there is nothing to report').toEqual([]);
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
  expect(wd.tick().newAlerts.length, 'retirement must not be mistaken for acknowledgement').toBe(1);
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
  expect(wd.tick().newAlerts, 'silence we caused ourselves says nothing about the agent').toEqual([]);
});

test('stuck: an alert raised while watching is kept, not retracted, once blind', () => {
  const clock = clockAt();
  let sighted = true;
  const wd = createWatchdog({ now: clock.now, canObserve: () => sighted });
  wd.processEvent(pre({ at: T - 4 * 60_000, id: 't1' }));
  expect(wd.tick().newAlerts.length).toBe(1);

  sighted = false;
  clock.advance(60 * 60_000); // an hour blind, well past the abandoned horizon
  wd.tick();
  expect(wd.getActiveAlerts().length, 'losing the sensor is not evidence the alarm cleared').toBe(1);
});

test('stuck: judgment resumes when sight returns', () => {
  const clock = clockAt();
  let sighted = false;
  const wd = createWatchdog({ now: clock.now, canObserve: () => sighted });
  wd.processEvent(pre({ at: T - 4 * 60_000, id: 't1' }));
  expect(wd.tick().newAlerts).toEqual([]);
  sighted = true;
  expect(wd.tick().newAlerts.length).toBe(1);
});

test('loop still fires while blind — it judges events, never their absence', () => {
  const clock = clockAt();
  const wd = createWatchdog({ now: clock.now, canObserve: () => false });
  let last: Alert[] = [];
  for (let i = 0; i < 4; i++) last = wd.processEvent(pre({ at: T - 15_000 + i * 5_000, id: `t${i}` })).newAlerts;
  expect(last.length, 'an event in hand is proof regardless of the channel').toBe(1);
});

// ─── standing: a state does not go out of date ─────────────────────────────
// Freshness judged at the display gives the badge a two-minute expiry. For an
// event-driven alert that is right — it reports something that is
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
  const alert = wd.tick().newAlerts[0]!;
  expect(alert.standing, 'the display reads a flag, it cannot guess the type').toBe(true);

  clock.advance(10 * 60_000);   // nothing happened, nobody acknowledged
  wd.tick();                    // and the watchdog has looked again since
  expect(wd.getActiveAlerts().length, 'the watchdog still judges the session stuck').toBe(1);
  expect(isFresh(alert, clock.now()), 'so the badge has to keep saying so').toBe(true);
});

test('loop: an event-driven alert is not standing, and does go out of date', () => {
  const clock = clockAt();
  const wd = createWatchdog({ now: clock.now });
  let last: Alert[] = [];
  for (let i = 0; i < 4; i++) {
    last = wd.processEvent(pre({ at: T - 15_000 + i * 5_000, id: `t${i}` })).newAlerts;
  }
  const alert = last[0]!;
  expect(alert.standing, 'something that is over is not a standing condition').toBe(false);
  expect(isFresh(alert, alert.createdAt), 'news while it is news').toBe(true);
  expect(isFresh(alert, alert.createdAt + 2 * 60_000 + 1), 'history two minutes later').toBe(false);
});

test('stuck: standing is not immortal — the detector still takes its alert back', () => {
  const clock = clockAt();
  const wd = createWatchdog({ now: clock.now });
  wd.processEvent(pre({ at: T - 4 * 60_000, id: 't1' }));
  const alert = wd.tick().newAlerts[0]!;
  // The tool comes back, so the condition is over. Freshness would hold on to
  // this alert for ever — the withdrawal can only come from the detector.
  wd.processEvent({
    session_id: 'sid1', hook_event_name: 'PostToolUse',
    tool_name: 'Bash', tool_use_id: 't1', _ts: iso(T),
  });
  wd.tick();
  clock.advance(10 * 60_000);
  expect(isFresh(alert, clock.now()), 'the clock alone will never drop it').toBe(true);
  expect(wd.getActiveAlerts().filter(a => isFresh(a, clock.now())), 'and still nothing is shown: what stands has to be able to stop standing').toEqual([]);
});

// ─── The dedup registry is not the display ─────────────────────────────────
// The display filters stale alerts, but the dedup lock lives in detection: with an identity
// of `loop:<session>:<tool>` and no end of episode, one ghost would silence that tool for the
// rest of the session, unacknowledgeably — the button only exists for what the display renders.
//
// "Should we shout?" and "is this still the same incident?" are different questions.
// Freshness answers the first at the display; `isStale` answers the second, each
// detector from its own definition.

test('loop: un episode clos ne verrouille pas le suivant', () => {
  const clock = clockAt();
  const wd = createWatchdog({ now: clock.now });
  let first: Alert[] = [];
  for (let i = 0; i < 4; i++) {
    first = wd.processEvent(pre({ at: T - 15_000 + i * 5_000, id: `a${i}` })).newAlerts;
  }
  expect(first.length).toBe(1);

  clock.advance(5 * 60_000);
  wd.tick();
  const at = clock.now();
  let second: Alert[] = [];
  for (let i = 0; i < 4; i++) {
    second = wd.processEvent(pre({ at: at + i * 5_000, id: `b${i}` })).newAlerts;
  }
  expect(second.length, 'the same tool looping again later is a new incident').toBe(1);
  expect(second[0]!.createdAt).not.toBe(first[0]!.createdAt);
});

test('loop: deux episodes du meme rattrapage entrent tous les deux', () => {
  // The server's start-up sweep replays a whole file with no tick in between.
  // Retiring on tick alone would not save the afternoon episode: the lock has
  // to break on the emission path too, or the journal keeps only the first.
  const wd = createWatchdog({ now: () => T + 5 * 3_600_000 });
  const morning = T;
  const afternoon = T + 4 * 3_600_000;
  const raised: Alert[] = [];
  for (const base of [morning, afternoon]) {
    for (let i = 0; i < 4; i++) {
      raised.push(...wd.processEvent(pre({ at: base + i * 5_000, id: `${base}-${i}` })).newAlerts);
    }
  }
  expect(raised.length, 'four hours apart is two incidents, and no tick came between').toBe(2);
  expect(raised.map(a => a.createdAt)).toEqual([morning + 15_000, afternoon + 15_000]);
});

test('loop: dans la meme fenetre, c est toujours le meme incident', () => {
  // The negative control — breaking the lock must not turn one runaway into a
  // new alert every few calls — and the reason the lock is judged in the event
  // stream's own time. These eight calls really did happen inside half a
  // minute; replaying them an hour later must not split them into five
  // incidents because OUR clock has moved on since.
  const wd = createWatchdog({ now: () => T + 3_600_000 });
  const raised: Alert[] = [];
  for (let i = 0; i < 8; i++) {
    raised.push(...wd.processEvent(pre({ at: T - 30_000 + i * 4_000, id: `t${i}` })).newAlerts);
  }
  expect(raised.length, 'eight calls inside half a minute are one loop, not five').toBe(1);
});

test('retryStorm: tant que ca echoue, c est le meme orage', () => {
  const clock = clockAt();
  const wd = createWatchdog({ now: clock.now });
  const raised: Alert[] = [];
  for (let i = 0; i < 6; i++) {
    raised.push(...wd.processEvent(fail({ at: T + i * 1_000, id: `x${i}` })).newAlerts);
    // The client beats every five seconds whether or not anything happened,
    // and a beat must not touch this alert. Judging the dedup lock here made
    // the storm vanish one beat after it was reported and announce itself
    // again on every later failure.
    clock.advance(5_000);
    wd.tick();
  }
  expect(raised.length, 'six failures with nothing succeeding in between are one storm').toBe(1);
  expect(wd.getActiveAlerts().length, 'and it is still there to be acknowledged').toBe(1);
});

test('loop: l alerte reste affichable et acquittable au-dela de sa fenetre', () => {
  const clock = clockAt();
  const wd = createWatchdog({ now: clock.now });
  let last: Alert[] = [];
  for (let i = 0; i < 4; i++) last = wd.processEvent(pre({ at: T + i * 1_000, id: `a${i}` })).newAlerts;
  const alert = last[0]!;

  clock.advance(90_000);   // past loop's 60s window, inside the 120s display cut
  wd.tick();
  expect(wd.getActiveAlerts().length, 'the window bounds an episode, not how long its report is worth reading').toBe(1);
  expect(isFresh(alert, alert.createdAt + 90_000), 'and freshness, not the window, is what governs the display').toBe(true);
  wd.acknowledge(alert.id);
  expect(wd.getActiveAlerts(), 'acknowledging it still does something').toEqual([]);
});

test('retryStorm: deux sous-agents sur le meme outil ont deux compteurs', () => {
  const clock = clockAt();
  const wd = createWatchdog({ now: clock.now });
  const byAgent = (at: number, id: string, agent: string) => ({ ...fail({ at, id }), agent_id: agent, agent_type: 'Explore' });
  const raised: Alert[] = [];
  const trio: [number, string, string][] = [[T, 'a1', 'A'], [T + 1_000, 'a2', 'A'],
                               [T + 2_000, 'b1', 'B'], [T + 3_000, 'b2', 'B']];
  for (const [at, id, who] of trio) {
    raised.push(...wd.processEvent(byAgent(at, id, who)).newAlerts);
  }
  expect(raised, 'two failures each is nobody at three — one shared counter would have fired').toEqual([]);

  const rA = wd.processEvent(byAgent(T + 4_000, 'a3', 'A')).newAlerts;
  expect(rA.length, 'A reaches three on its own').toBe(1);
  expect(rA[0]!.agentId).toBe('A');
  expect(rA[0]!.count, 'and it counted A s failures only').toBe(3);
});

test('retryStorm: le succes d un sous-agent ne relance pas l orage de l autre', () => {
  const clock = clockAt();
  const wd = createWatchdog({ now: clock.now });
  const byAgent = (at: number, id: string, agent: string) => ({ ...fail({ at, id }), agent_id: agent });
  const raised: Alert[] = [];
  for (let i = 0; i < 3; i++) raised.push(...wd.processEvent(byAgent(T + i * 1_000, `a${i}`, 'A')).newAlerts);
  expect(raised.length, 'A is in a storm').toBe(1);

  // B succeeds on the same tool. On a shared counter this would zero A's
  // series, hand back A's dedup lock, and let A's next three failures report
  // the very same storm a second time.
  wd.processEvent({
    session_id: 'sid1', hook_event_name: 'PostToolUse', tool_name: 'Bash',
    tool_use_id: 'b1', agent_id: 'B', _ts: iso(T + 4_000),
  });
  const after: Alert[] = [];
  for (let i = 0; i < 3; i++) {
    after.push(...wd.processEvent(byAgent(T + 5_000 + i * 1_000, `a${3 + i}`, 'A')).newAlerts);
  }
  expect(after, 'B s success says nothing about A s series').toEqual([]);
});

test('retryStorm: un succes clot l orage, la serie suivante sonne de nouveau', () => {
  const clock = clockAt();
  const wd = createWatchdog({ now: clock.now });
  const raised: Alert[] = [];
  for (let i = 0; i < 3; i++) raised.push(...wd.processEvent(fail({ at: T + i * 1_000, id: `x${i}` })).newAlerts);
  expect(raised.length, 'three consecutive failures are a storm').toBe(1);

  wd.processEvent({
    session_id: 'sid1', hook_event_name: 'PostToolUse',
    tool_name: 'Bash', tool_use_id: 'ok', _ts: iso(T + 4_000),
  });
  for (let i = 0; i < 3; i++) {
    raised.push(...wd.processEvent(fail({ at: T + 10_000 + i * 1_000, id: `y${i}` })).newAlerts);
  }
  expect(raised.length, 'a series that starts after a success is a new storm').toBe(2);
});

// ─── Thresholds ────────────────────────────────────────────────────────────

test('partial thresholds merge over the defaults', () => {
  const clock = clockAt();
  const wd = createWatchdog({ now: clock.now, thresholds: { loop: { count: 2 } } });
  wd.processEvent(pre({ at: T - 5_000, id: 't1' }));
  const r = wd.processEvent(pre({ at: T, id: 't2' }));
  expect(r.newAlerts.length, 'the overridden count applies').toBe(1);
  expect(r.newAlerts[0]!.count, 'and windowMs kept its default').toBe(2);
});

test('abandonedMs is configurable', () => {
  const clock = clockAt();
  const wd = createWatchdog({ now: clock.now, thresholds: { stuck: { abandonedMs: 3 * 60 * 60_000 } } });
  wd.processEvent(pre({ at: T - 2 * 60 * 60_000, id: 't1' }));
  expect(wd.tick().newAlerts.length, 'a three-hour horizon still calls two hours stuck').toBe(1);
});

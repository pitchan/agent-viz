// Unit tests for src/engine/watchdog/detector.ts — the toxic-pattern detector.
//
// Pure-module tests: no DOM, no fs, no network. We control time via a
// fake clock and pump synthetic event sequences in.

import { expect, test } from 'vitest';
import { createWatchdog, type Alert } from '../../src/engine/watchdog/detector.ts';

function makeClock(start = 1_700_000_000_000) {
  let t = start;
  return {
    now: () => t,
    advance(ms: number) { t += ms; },
    set(v: number) { t = v; },
  };
}

function preToolUse({ session = 'sid1', tool = 'Edit', input = { file_path: 'a.js' }, id = 't1' } = {}) {
  return {
    session_id: session, hook_event_name: 'PreToolUse',
    tool_name: tool, tool_input: input, tool_use_id: id,
  };
}
function postOk({ session = 'sid1', tool = 'Edit', id = 't1' } = {}) {
  return { session_id: session, hook_event_name: 'PostToolUse', tool_name: tool, tool_use_id: id };
}
function postFail({ session = 'sid1', tool = 'Edit', id = 't1' } = {}) {
  return { session_id: session, hook_event_name: 'PostToolUseFailure', tool_name: tool, tool_use_id: id };
}

// ─── Loop detector ─────────────────────────────────────────────────────────

test('loop: 4× same Edit input within window → alert', () => {
  const clock = makeClock();
  const wd = createWatchdog({ now: clock.now });
  let lastAlerts: Alert[] = [];
  for (let i = 0; i < 4; i++) {
    lastAlerts = wd.processEvent(preToolUse({ id: `t${i}` })).newAlerts;
    if (i < 3) clock.advance(5_000); // spread within window
  }
  expect(lastAlerts.length).toBe(1);
  expect(lastAlerts[0]!.type).toBe('loop');
  expect(lastAlerts[0]!.toolName).toBe('Edit');
  expect(lastAlerts[0]!.count).toBe(4);
});

test('loop: 3× same input → no alert (under threshold)', () => {
  const clock = makeClock();
  const wd = createWatchdog({ now: clock.now });
  for (let i = 0; i < 3; i++) {
    const r = wd.processEvent(preToolUse({ id: `t${i}` }));
    expect(r.newAlerts.length).toBe(0);
    clock.advance(5_000);
  }
  expect(wd.getActiveAlerts().length).toBe(0);
});

test('loop: 4× spread beyond window → no alert', () => {
  const clock = makeClock();
  const wd = createWatchdog({ now: clock.now });
  for (let i = 0; i < 4; i++) {
    const r = wd.processEvent(preToolUse({ id: `t${i}` }));
    expect(r.newAlerts.length).toBe(0);
    clock.advance(30_000); // 30s × 3 = 90s spread, > 60s window
  }
});

test('loop: 4× with different tool_input → no alert', () => {
  const clock = makeClock();
  const wd = createWatchdog({ now: clock.now });
  for (let i = 0; i < 4; i++) {
    const r = wd.processEvent(preToolUse({ id: `t${i}`, input: { file_path: `f${i}.js` } }));
    expect(r.newAlerts.length).toBe(0);
    clock.advance(5_000);
  }
});

test('loop: dedup — same loop fires once until acknowledged', () => {
  const clock = makeClock();
  const wd = createWatchdog({ now: clock.now });
  let alertId: string | null = null;
  for (let i = 0; i < 6; i++) {
    const r = wd.processEvent(preToolUse({ id: `t${i}` }));
    if (r.newAlerts.length) alertId = r.newAlerts[0]!.id;
    clock.advance(2_000);
  }
  // Only the first crossing of the threshold should have produced an alert.
  expect(alertId).toBeTruthy();
  expect(wd.getActiveAlerts().length).toBe(1);

  // Ack → still no re-fire on next identical event.
  wd.acknowledge(alertId!);
  expect(wd.getActiveAlerts().length).toBe(0);

  // After ack, fresh trigger fires again.
  for (let i = 0; i < 4; i++) {
    wd.processEvent(preToolUse({ id: `r${i}` }));
    clock.advance(2_000);
  }
  expect(wd.getActiveAlerts().length).toBe(1);
});

// ─── Retry-storm detector ──────────────────────────────────────────────────

test('retryStorm: 3 consecutive PostToolUseFailure on same tool → alert', () => {
  const clock = makeClock();
  const wd = createWatchdog({ now: clock.now });
  let r;
  r = wd.processEvent(postFail()); expect(r.newAlerts.length).toBe(0);
  r = wd.processEvent(postFail()); expect(r.newAlerts.length).toBe(0);
  r = wd.processEvent(postFail()); expect(r.newAlerts.length).toBe(1);
  expect(r.newAlerts[0]!.type).toBe('retryStorm');
  expect(r.newAlerts[0]!.toolName).toBe('Edit');
  expect(r.newAlerts[0]!.count).toBe(3);
});

test('retryStorm: an intervening success resets the counter', () => {
  const clock = makeClock();
  const wd = createWatchdog({ now: clock.now });
  wd.processEvent(postFail());
  wd.processEvent(postFail());
  wd.processEvent(postOk());  // reset
  let r;
  r = wd.processEvent(postFail()); expect(r.newAlerts.length).toBe(0);
  r = wd.processEvent(postFail()); expect(r.newAlerts.length).toBe(0);
  r = wd.processEvent(postFail()); expect(r.newAlerts.length).toBe(1);
});

test('retryStorm: failures on different tools tracked separately', () => {
  const clock = makeClock();
  const wd = createWatchdog({ now: clock.now });
  wd.processEvent(postFail({ tool: 'Edit' }));
  wd.processEvent(postFail({ tool: 'Bash' }));
  wd.processEvent(postFail({ tool: 'Edit' }));
  wd.processEvent(postFail({ tool: 'Bash' }));
  // Neither has hit 3 yet
  expect(wd.getActiveAlerts().length).toBe(0);
  const r = wd.processEvent(postFail({ tool: 'Edit' }));
  expect(r.newAlerts.length).toBe(1);
  expect(r.newAlerts[0]!.toolName).toBe('Edit');
});

// ─── Stuck detector ────────────────────────────────────────────────────────

test('stuck: tool running + clock advances past silenceMs → alert', () => {
  const clock = makeClock();
  const wd = createWatchdog({ now: clock.now });
  wd.processEvent(preToolUse({ id: 't1' }));
  clock.advance(3 * 60_000 + 1);
  const r = wd.tick();
  expect(r.newAlerts.length).toBe(1);
  expect(r.newAlerts[0]!.type).toBe('stuck');
});

test('stuck: event between threshold reset — no alert', () => {
  const clock = makeClock();
  const wd = createWatchdog({ now: clock.now });
  wd.processEvent(preToolUse({ id: 't1' }));
  clock.advance(2 * 60_000);
  wd.processEvent(preToolUse({ id: 't2' })); // refreshes lastEventAt
  clock.advance(2 * 60_000);                  // still under 3 min from t2
  const r = wd.tick();
  expect(r.newAlerts.length).toBe(0);
});

test('stuck: no running tools → no alert even after long silence', () => {
  const clock = makeClock();
  const wd = createWatchdog({ now: clock.now });
  wd.processEvent(preToolUse({ id: 't1' }));
  wd.processEvent(postOk({ id: 't1' }));   // running set now empty
  clock.advance(10 * 60_000);
  const r = wd.tick();
  expect(r.newAlerts.length).toBe(0);
});

test('stuck: SessionEnd clears running set', () => {
  const clock = makeClock();
  const wd = createWatchdog({ now: clock.now });
  wd.processEvent(preToolUse({ id: 't1' }));
  wd.processEvent({ session_id: 'sid1', hook_event_name: 'SessionEnd' });
  clock.advance(10 * 60_000);
  const r = wd.tick();
  expect(r.newAlerts.length).toBe(0);
});

test('stuck: dedup — repeated ticks while still stuck only fire once', () => {
  const clock = makeClock();
  const wd = createWatchdog({ now: clock.now });
  wd.processEvent(preToolUse({ id: 't1' }));
  clock.advance(3 * 60_000 + 1);
  const r1 = wd.tick();
  expect(r1.newAlerts.length).toBe(1);
  clock.advance(60_000);
  const r2 = wd.tick();
  expect(r2.newAlerts.length).toBe(0); // already active
  expect(wd.getActiveAlerts().length).toBe(1);
});

// ─── Cross-cutting ─────────────────────────────────────────────────────────

test('acknowledge removes the alert from getActiveAlerts', () => {
  const clock = makeClock();
  const wd = createWatchdog({ now: clock.now });
  const r = wd.processEvent(postFail());
  wd.processEvent(postFail());
  const alert = wd.processEvent(postFail()).newAlerts[0]!;
  expect(wd.getActiveAlerts().length).toBe(1);
  wd.acknowledge(alert.id);
  expect(wd.getActiveAlerts().length).toBe(0);
});

test('two sessions tracked independently', () => {
  const clock = makeClock();
  const wd = createWatchdog({ now: clock.now });
  for (let i = 0; i < 4; i++) {
    wd.processEvent(preToolUse({ session: 'sidA', id: `a${i}` }));
    clock.advance(5_000);
  }
  // sidB only has 2 events → no alert for it
  wd.processEvent(preToolUse({ session: 'sidB', id: 'b1' }));
  wd.processEvent(preToolUse({ session: 'sidB', id: 'b2' }));
  const actives = wd.getActiveAlerts();
  expect(actives.length).toBe(1);
  expect(actives[0]!.sessionId).toBe('sidA');
});

test('event without session_id is harmless', () => {
  const wd = createWatchdog();
  const r = wd.processEvent({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: {} });
  expect(r.newAlerts.length).toBe(0);
});

test('custom thresholds are honored', () => {
  const clock = makeClock();
  const wd = createWatchdog({
    now: clock.now,
    thresholds: {
      loop: { windowMs: 10_000, count: 2 },
      retryStorm: { count: 2 },
      stuck: { silenceMs: 30_000 },
    },
  });
  wd.processEvent(preToolUse({ id: 't1' }));
  const r = wd.processEvent(preToolUse({ id: 't2' }));
  expect(r.newAlerts.length, 'loop fires at count=2 with custom threshold').toBe(1);
});

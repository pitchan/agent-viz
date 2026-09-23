// Unit tests for src/web/viz-alert-format.ts — how an alert is worded.
//
// Two consumers share this: the alerts popup and the OS notification. The
// notification is the half no browser test can see (Playwright cannot look at
// a Windows toast), so the wording is pulled out into a pure function and
// pinned here. What the bubble *displays* still needs a human; what it *says*
// is proved below.

import { expect, test } from 'vitest';
import { alertActor, alertActorLine, alertDetailLines, notificationPayload } from '../../src/web/viz-alert-format.ts';
import { pricingAdoptedAlert } from '../../src/web/viz-pricing-adopted-alert.ts';
import { adoptedOf } from '../helpers/pricing-adopted.ts';
import { clockTime } from '../../src/engine/core/clock-time.ts';

// Built from local-time components so the expectation holds in any timezone.
const at = (h: number, m: number, s: number) => new Date(2026, 7, 7, h, m, s).getTime();

function loopAlert(over: Record<string, any> = {}) {
  return {
    type: 'loop', sessionId: 'sid-abcdef12', toolName: 'Bash', count: 4,
    createdAt: at(14, 3, 24), message: 'Bash called 4× with the same input in 15s',
    agentId: '', agentType: '', subject: 'npm test',
    occurrences: [at(14, 3, 9), at(14, 3, 14), at(14, 3, 19), at(14, 3, 24)]
      .map((ts, i) => ({ ts, toolUseId: `t${i}`, failed: null })),
    tools: [], acknowledged: false, id: 'loop:sid-abcdef12:Bash', ...over,
  };
}

function stuckAlert(over: Record<string, any> = {}) {
  return {
    type: 'stuck', sessionId: 'sid-abcdef12', toolName: '', count: 2,
    createdAt: at(14, 10, 0), message: 'No event for 240s while 2 tool(s) still running',
    agentId: '', agentType: '', subject: '', occurrences: [],
    tools: [
      { toolUseId: 'tA', toolName: 'Bash', subject: 'npm run build', startedAt: at(14, 5, 0), agentId: '', agentType: '' },
      { toolUseId: 'tB', toolName: 'Read', subject: 'hook.js', startedAt: at(14, 6, 0), agentId: 'ag-9c2f11a0', agentType: 'Explore' },
    ],
    acknowledged: false, id: 'stuck:sid-abcdef12', ...over,
  };
}

// ─── Clock ─────────────────────────────────────────────────────────────────

test('clockTime renders a wall-clock time, zero-padded', () => {
  expect(clockTime(at(14, 3, 9))).toBe('14:03:09');
  expect(clockTime(at(9, 0, 0))).toBe('09:00:00');
});

// ─── Who ───────────────────────────────────────────────────────────────────

test('alertActor names the subagent by type and short id', () => {
  expect(alertActor(loopAlert({ agentId: 'ag-9c2f11a0', agentType: 'Explore' }))).toBe('Explore ag-9c2f1');
});

test('alertActor says main thread when no agent ran it', () => {
  expect(alertActor(loopAlert())).toBe('main thread');
});

test('alertActorLine nomme l\'acteur d\'une alerte de session et se tait pour un stuck', () => {
  // Arrange
  const alertes = [loopAlert(), loopAlert({ agentId: 'ag-9c2f11a0', agentType: 'Explore' }), stuckAlert()];

  // Act
  const lignes = alertes.map(alertActorLine);

  // Assert
  expect(lignes).toEqual(['main thread', 'Explore ag-9c2f1', '']);
});

// ─── Detail lines ──────────────────────────────────────────────────────────

test('a loop lists the real clock time of every repeat', () => {
  expect(alertDetailLines(loopAlert())).toEqual(['Repeats at 14:03:09, 14:03:14, 14:03:19, 14:03:24']);
});

// Only loop's window bounds `occurrences`: repeats keep piling up while an alert
// is active and deduplicated, so the next one emitted once the lock breaks carries
// a whole window — 240 of them at four calls a second.
test('a loop caps how many repeat times it prints and says what it dropped', () => {
  const many = Array.from({ length: 240 }, (_, i) => ({
    ts: at(14, 3, 0) + i * 250, toolUseId: `t${i}`, failed: null,
  }));
  const lines = alertDetailLines(loopAlert({ occurrences: many, count: 240 }));
  expect(lines.length).toBe(1);
  expect(lines[0]!, 'ce qui est retire doit etre annonce').toMatch(/…and 235 more$/);
  expect(lines[0]!.split(',').length, 'cinq horodatages, pas deux cent quarante').toBe(5);
  expect(lines[0]!.length < 120,
    `une ligne de panneau reste lisible, celle-ci fait ${lines[0]!.length} caracteres`).toBeTruthy();
});

test('a loop list of exactly the cap prints no overflow line', () => {
  const exactly = Array.from({ length: 5 }, (_, i) => ({
    ts: at(14, 3, 0) + i * 1000, toolUseId: `t${i}`, failed: null,
  }));
  const lines = alertDetailLines(loopAlert({ occurrences: exactly, count: 5 }));
  expect(lines[0], 'rien n a ete retire, rien ne doit le dire').not.toMatch(/more/);
});

// The line leads with the clock so the list can be scanned down its left
// edge, and names an actor only when there is one to name — repeating
// "(main thread)" on every row is noise that pushes the subject off-screen.
test('a stuck alert lists each in-flight tool with its subject and start time', () => {
  expect(alertDetailLines(stuckAlert())).toEqual([
    '14:05:00 · Bash · npm run build',
    '14:06:00 · Read · hook.js · Explore ag-9c2f1',
  ]);
});

// A stuck alert can hold many tools, each with an arbitrarily long command.
// Rendered whole, one alert turns the panel into a wall of text — horizontally
// clean and completely unreadable.

test('a stuck list cuts each subject shorter than a standalone one', () => {
  const long = 'node scripts/' + 'x'.repeat(280) + '.js';
  const lines = alertDetailLines(stuckAlert({
    tools: [{ toolUseId: 'tA', toolName: 'Bash', subject: long, startedAt: at(14, 5, 0), agentId: '', agentType: '' }],
  }));
  expect(lines.length).toBe(1);
  const shown = lines[0]!.split(' · ')[2]!;
  expect(shown.length, 'a list row has to fit the panel width on one line').toBe(40);
  expect(shown.endsWith('…')).toBeTruthy();
});

test('a stuck list caps how many tools it prints and says what it dropped', () => {
  const tools = Array.from({ length: 9 }, (_, i) => ({
    toolUseId: `t${i}`, toolName: 'Bash', subject: `cmd ${i}`,
    startedAt: at(14, 5, i), agentId: '', agentType: '',
  }));
  const lines = alertDetailLines(stuckAlert({ tools, count: 9 }));
  expect(lines.length, 'five tools plus one line accounting for the rest').toBe(6);
  expect(lines[5]).toBe('…and 4 more');
});

test('a stuck list of exactly the cap prints no overflow line', () => {
  const tools = Array.from({ length: 5 }, (_, i) => ({
    toolUseId: `t${i}`, toolName: 'Bash', subject: `cmd ${i}`,
    startedAt: at(14, 5, i), agentId: '', agentType: '',
  }));
  expect(alertDetailLines(stuckAlert({ tools, count: 5 })).length).toBe(5);
});

test('an alert with nothing structured to add produces no detail lines', () => {
  const retry = { ...loopAlert(), type: 'retryStorm', occurrences: [], tools: [] };
  expect(alertDetailLines(retry)).toEqual([]);
});

// ─── Notification body ─────────────────────────────────────────────────────

test('notification body carries the command and the repeat times, not just the pattern name', () => {
  const { title, body } = notificationPayload(loopAlert());
  expect(title).toBe('agent-viz: loop');
  expect(body).toBe(
    'Bash called 4× with the same input in 15s\n'
    + 'npm test\n'
    + 'Repeats at 14:03:09, 14:03:14, 14:03:19, 14:03:24\n'
    + 'main thread',
  );
});

test('notification body names the agent when a subagent is at fault', () => {
  const { body } = notificationPayload(loopAlert({ agentId: 'ag-9c2f11a0', agentType: 'Explore' }));
  expect(body).toMatch(/Explore ag-9c2f1$/);
});

test('notification body of a stuck alert says what is in flight', () => {
  const { body } = notificationPayload(stuckAlert());
  expect(body).toBe(
    'No event for 240s while 2 tool(s) still running\n'
    + '14:05:00 · Bash · npm run build\n'
    + '14:06:00 · Read · hook.js · Explore ag-9c2f1',
  );
});

test('la notification d\'une alerte hors session ne nomme aucun acteur', () => {
  // Arrange
  const derive = pricingAdoptedAlert(adoptedOf('claude-opus-6', 'modele-nouveau'), at(14, 3, 24));

  // Act
  const { body } = notificationPayload(derive);

  // Assert
  expect(body).toBe(`${derive.message}\n${derive.subject}`);
});

test('an oversized command is cut, so one alert cannot flood the panel', () => {
  const huge = 'x'.repeat(500);
  const { body } = notificationPayload(loopAlert({ subject: huge }));
  const line = body.split('\n')[1]!;
  expect(line.length).toBe(200);
  expect(line.endsWith('…'), 'the cut must be visible, not silent').toBeTruthy();
});

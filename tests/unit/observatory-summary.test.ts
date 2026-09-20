// Period totals. All session costs come from one price table (netgain's), so
// they can be summed — but a single partially-priced session makes the whole
// total partial, and cacheRead is never folded into net tokens.

import { expect, test } from 'vitest';
import { computeSummary } from '../../src/server/observatory/summary.ts';
import type { Session } from '../../src/server/observatory/rules/types.ts';

const session = (id: string, over: Record<string, unknown> = {}) => ({
  id, project: 'F--proj', startedAt: '2026-07-01T10:00:00.000Z', endedAt: '2026-07-01T10:30:00.000Z',
  netTokens: 1000, costUsd: 2, costComplete: true,
  report: { tokens: { total: { in: 100, out: 50, cacheCreate: 850, cacheRead: 9000 } }, parseErrors: 0 },
  ...over,
} as unknown as Session);
const CTX = { lastScanAt: '2026-07-15T12:00:00.000Z' };

test('totals add sessions, net tokens and cost', () => {
  const s = computeSummary([session('s1'), session('s2')], CTX);
  expect(s.sessions).toBe(2);
  expect(s.netTokens).toBe(2000);
  expect(s.costUsd).toBe(4);
  expect(s.costComplete).toBe(true);
});

test('cacheRead is reported apart, never inside net tokens', () => {
  const s = computeSummary([session('s1')], CTX);
  expect(s.netTokens).toBe(1000);
  expect(s.cacheReadTokens).toBe(9000);
});

test('one partially-priced session makes the whole total partial', () => {
  const s = computeSummary([session('s1'), session('s2', { costComplete: false })], CTX);
  expect(s.costComplete).toBe(false);
  expect(s.anomalies.partialCostSessions).toBe(1);
});

test('parse errors are surfaced, not swallowed', () => {
  const s = computeSummary([session('s1', {
    report: { tokens: { total: { in: 0, out: 0, cacheCreate: 0, cacheRead: 0 } }, parseErrors: 3 },
  })], CTX);
  expect(s.anomalies.parseErrors).toBe(3);
});

test('an empty period returns zeros and a complete cost, never NaN', () => {
  const s = computeSummary([], CTX);
  expect({ sessions: s.sessions, netTokens: s.netTokens, costUsd: s.costUsd, costComplete: s.costComplete }).toEqual({ sessions: 0, netTokens: 0, costUsd: 0, costComplete: true });
});

test('the scan date travels with the totals', () => {
  const s = computeSummary([], CTX);
  expect(s.lastScanAt).toBe('2026-07-15T12:00:00.000Z');
});

test('computeSummary carries the announced basis and the period untouched', () => {
  const basis = { counts: { interactive: 12, headless: 640, unknown: 3 }, includeMachine: false };
  const period = { from: '2026-07-04T00:00:00.000Z', to: '2026-08-03T00:00:00.000Z', days: 30 };
  const out = computeSummary([], { lastScanAt: null, basis, period });
  expect(out.basis).toEqual(basis);
  expect(out.period).toEqual(period);
});

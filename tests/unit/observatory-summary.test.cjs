'use strict';
// Period totals. All session costs come from one price table (netgain's), so
// they can be summed — but a single partially-priced session makes the whole
// total partial, and cacheRead is never folded into net tokens.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { computeSummary } = require('../../src/server/observatory/summary.ts');

const session = (id, over = {}) => ({
  id, project: 'F--proj', startedAt: '2026-07-01T10:00:00.000Z', endedAt: '2026-07-01T10:30:00.000Z',
  netTokens: 1000, costUsd: 2, costComplete: true,
  report: { tokens: { total: { in: 100, out: 50, cacheCreate: 850, cacheRead: 9000 } }, parseErrors: 0 },
  ...over,
});
const CTX = { lastScanAt: '2026-07-15T12:00:00.000Z', engine: { ok: true, error: null } };

test('totals add sessions, net tokens and cost', () => {
  const s = computeSummary([session('s1'), session('s2')], CTX);
  assert.equal(s.sessions, 2);
  assert.equal(s.netTokens, 2000);
  assert.equal(s.costUsd, 4);
  assert.equal(s.costComplete, true);
});

test('cacheRead is reported apart, never inside net tokens', () => {
  const s = computeSummary([session('s1')], CTX);
  assert.equal(s.netTokens, 1000);
  assert.equal(s.cacheReadTokens, 9000);
});

test('one partially-priced session makes the whole total partial', () => {
  const s = computeSummary([session('s1'), session('s2', { costComplete: false })], CTX);
  assert.equal(s.costComplete, false);
  assert.equal(s.anomalies.partialCostSessions, 1);
});

test('parse errors are surfaced, not swallowed', () => {
  const s = computeSummary([session('s1', {
    report: { tokens: { total: { in: 0, out: 0, cacheCreate: 0, cacheRead: 0 } }, parseErrors: 3 },
  })], CTX);
  assert.equal(s.anomalies.parseErrors, 3);
});

test('an empty period returns zeros and a complete cost, never NaN', () => {
  const s = computeSummary([], CTX);
  assert.deepEqual(
    { sessions: s.sessions, netTokens: s.netTokens, costUsd: s.costUsd, costComplete: s.costComplete },
    { sessions: 0, netTokens: 0, costUsd: 0, costComplete: true });
});

test('the scan date and engine state travel with the totals', () => {
  const s = computeSummary([], CTX);
  assert.equal(s.lastScanAt, '2026-07-15T12:00:00.000Z');
  assert.deepEqual(s.engine, { ok: true, error: null });
});

test('computeSummary carries the announced basis and the period untouched', () => {
  const basis = { counts: { interactive: 12, headless: 640, unknown: 3 }, includeMachine: false };
  const period = { from: '2026-07-04T00:00:00.000Z', to: '2026-08-03T00:00:00.000Z', days: 30 };
  const out = computeSummary([], { lastScanAt: null, engine: null, basis, period });
  assert.deepEqual(out.basis, basis);
  assert.deepEqual(out.period, period);
});

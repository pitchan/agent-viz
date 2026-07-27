'use strict';
// R6 — subagents spawned on a task too short to need them.
//
// tokens.perAgent holds SUBAGENTS ONLY (the main agent has its own bucket) —
// pinned by the engine contract test, which is why the fixture below has no
// "main" key and why the rule sums perAgent as a whole.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const r6 = require('../../lib/server/observatory/rules/r6-short-subagents');

function session(id, { project = 'F--proj', startedAt = '2026-07-01T10:00:00.000Z',
  endedAt = '2026-07-01T10:02:00.000Z', spawnToolUses = 2, mainNet = 1000, subNet = 900,
  netTokens = 1900, costUsd = 1.9, costComplete = true } = {}) {
  return {
    id, project, startedAt, endedAt, netTokens, costUsd, costComplete,
    report: {
      subagents: { sidecarCount: 1, spawnToolUses, byType: {} },
      tokens: {
        main: { in: mainNet, out: 0, cacheCreate: 0, cacheRead: 5000 },
        perAgent: {
          'agent-aaa': { in: subNet, out: 0, cacheCreate: 0, cacheRead: 3000 },
        },
      },
    },
  };
}

const ctx = sessions => ({ sessions, configItems: [] });

test('R6 fires on a short session where subagents burn over 30 % of net tokens', () => {
  const recs = r6.evaluate(ctx([session('s1')]));
  assert.equal(recs.length, 1);
  assert.equal(recs[0].ruleId, 'R6');
  assert.equal(recs[0].subject, 'F--proj');
  assert.equal(recs[0].confidence, 'correlation');
  assert.equal(recs[0].costBasis, 'jetons-mesures');
  assert.equal(recs[0].evidence.subagentTokens, 900);
  assert.equal(recs[0].evidence.medianDurationSeconds, 120);
  assert.equal(recs[0].estimatedCostUsd, 0.9);
});

test('R6 excludes cacheRead from the subagent share', () => {
  // 900 net against 1900 net fires; the 3000 cacheRead must play no part.
  assert.equal(r6.evaluate(ctx([session('s1')]))[0].evidence.subagentTokens, 900);
});

test('R6 stays silent on a long session', () => {
  assert.deepEqual(r6.evaluate(ctx([session('s1', { endedAt: '2026-07-01T10:40:00.000Z' })])), []);
});

test('R6 stays silent when subagents stay under 30 % of net tokens', () => {
  assert.deepEqual(r6.evaluate(ctx([session('s1', { subNet: 100, netTokens: 1100 })])), []);
});

test('R6 stays silent with no subagent spawn at all', () => {
  assert.deepEqual(r6.evaluate(ctx([session('s1', { spawnToolUses: 0 })])), []);
});

test('R6 cannot judge a session with no timestamps and stays silent', () => {
  assert.deepEqual(r6.evaluate(ctx([session('s1', { startedAt: null })])), []);
  assert.deepEqual(r6.evaluate(ctx([session('s1', { endedAt: null })])), []);
});

test('R6 aggregates only the short sessions of a project', () => {
  const recs = r6.evaluate(ctx([
    session('s1'), session('s2'), session('s3', { endedAt: '2026-07-01T11:00:00.000Z' }),
  ]));
  assert.equal(recs.length, 1);
  assert.deepEqual(recs[0].evidence.sessions, ['s1', 's2']);
  assert.equal(recs[0].evidence.subagentTokens, 1800);
});

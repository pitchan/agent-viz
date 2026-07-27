'use strict';
// R1 — model switched mid-session. A session qualifies when its prefix-change
// churn dominates both compaction and expiration churn AND weighs enough
// against ITS OWN net tokens; the qualifying sessions are then grouped by
// project for display. Both gates are per session — that is how the 90-day
// calibration measured them (netgain/docs/calibration-observatoire-m1.md).

const { test } = require('node:test');
const assert = require('node:assert/strict');

const r1 = require('../../lib/server/observatory/rules/r1-prefix-change');
const { evaluateAll, RULES } = require('../../lib/server/observatory/rules/registry');

function session(id, { project = 'F--proj', prefixChange = 0, compaction = 0, expiration = 0,
  modelSwitch = null, netTokens = 100000, costUsd = 10, costComplete = true } = {}) {
  return {
    id, project, startedAt: '2026-07-01T10:00:00.000Z', endedAt: '2026-07-01T11:00:00.000Z',
    netTokens, costUsd, costComplete,
    report: {
      context: {
        churnCauses: {
          growth: { events: 0, tokens: 0 },
          compaction: { events: 1, tokens: compaction },
          expiration: { events: 1, tokens: expiration },
          prefixChange: { events: 1, tokens: prefixChange },
          unknown: { events: 0, tokens: 0 },
        },
        prefixBreakdown: { markers: {
          modelSwitch: { events: 1, tokens: modelSwitch === null ? prefixChange : modelSwitch },
          toolsAppeared: { events: 0, tokens: 0 },
          noMarker: { events: 0, tokens: 0 },
        } },
      },
    },
  };
}

const ctx = sessions => ({ sessions, configItems: [] });

test('R1 fires when prefix-change churn dominates, priced at the session rate', () => {
  const recs = r1.evaluate(ctx([session('s1', { prefixChange: 50000, compaction: 1000, expiration: 2000 })]));
  assert.equal(recs.length, 1);
  const rec = recs[0];
  assert.equal(rec.ruleId, 'R1');
  assert.equal(rec.subject, 'F--proj');
  assert.equal(rec.confidence, 'fait');
  assert.equal(rec.costBasis, 'jetons-mesures');
  assert.equal(rec.estimatedCostUsd, 5, '50000 tokens at $0.0001/token');
  assert.deepEqual(rec.evidence.sessions, ['s1']);
  assert.equal(rec.evidence.prefixChangeTokens, 50000);
  assert.equal(rec.evidence.costComplete, true);
});

test('R1 stays silent when compaction or expiration dominates', () => {
  assert.deepEqual(r1.evaluate(ctx([session('s1', { prefixChange: 10000, compaction: 50000 })])), []);
  assert.deepEqual(r1.evaluate(ctx([session('s1', { prefixChange: 10000, expiration: 50000 })])), []);
});

test('R1 stays silent when dominance is real but trivial against net tokens', () => {
  // Dominant, yet 1 % of the session's net tokens: below the calibrated 20 %.
  assert.deepEqual(r1.evaluate(ctx([session('s1', { prefixChange: 1000, netTokens: 100000 })])), []);
});

test('R1 stays silent when there is no prefix-change churn at all', () => {
  assert.deepEqual(r1.evaluate(ctx([session('s1')])), []);
});

test('R1 emits one recommendation per project, aggregating its sessions', () => {
  const recs = r1.evaluate(ctx([
    session('s1', { prefixChange: 40000, netTokens: 100000 }),
    session('s2', { prefixChange: 10000, netTokens: 40000 }),
    session('s3', { project: 'F--other', prefixChange: 20000, netTokens: 50000 }),
  ]));
  assert.deepEqual(recs.map(r => r.subject).sort(), ['F--other', 'F--proj']);
  const proj = recs.find(r => r.subject === 'F--proj');
  assert.deepEqual(proj.evidence.sessions, ['s1', 's2']);
  assert.equal(proj.evidence.prefixChangeTokens, 50000);
});

// The calibration measured the share threshold on SESSIONS (1695 of them), not
// on project aggregates: a project-level share would let one heavy session drag
// in quiet ones, and would fire on a different population than the one the
// 20 % was chosen against.
test('the share gate is applied per session, never to the project aggregate', () => {
  const recs = r1.evaluate(ctx([
    session('s1', { prefixChange: 40000, netTokens: 100000 }),  // 40 % — qualifies
    session('s2', { prefixChange: 1000, netTokens: 100000 }),   // 1 %  — does not
  ]));
  // The project aggregate is 41000/200000 = 20,5 %, above the floor: gating on
  // the aggregate would drag s2 in with its 1 %. Gating per session keeps it out.
  assert.equal(recs.length, 1);
  assert.deepEqual(recs[0].evidence.sessions, ['s1']);
  assert.equal(recs[0].evidence.prefixChangeTokens, 40000);
});

test('the share is computed on the sessions that fired, not on the whole project', () => {
  // s2 does not fire (compaction dominates); it must not dilute s1's share.
  const recs = r1.evaluate(ctx([
    session('s1', { prefixChange: 20000, netTokens: 100000 }),
    session('s2', { prefixChange: 0, compaction: 90000, netTokens: 900000 }),
  ]));
  assert.equal(recs.length, 1);
  assert.deepEqual(recs[0].evidence.sessions, ['s1']);
});

test('one partially-priced session marks the whole recommendation partial', () => {
  const recs = r1.evaluate(ctx([
    session('s1', { prefixChange: 40000, netTokens: 100000 }),
    session('s2', { prefixChange: 10000, netTokens: 40000, costComplete: false }),
  ]));
  assert.equal(recs[0].evidence.costComplete, false);
});

test('the registry exposes R1 and evaluateAll routes through it', () => {
  assert.ok(RULES.some(r => r.id === 'R1'));
  assert.deepEqual(evaluateAll(ctx([session('s1', { prefixChange: 50000 })])).map(r => r.ruleId), ['R1']);
});

test('a rule that throws never takes the whole evaluation down', () => {
  const boom = { id: 'RX', category: 'test', evaluate() { throw new Error('bug'); } };
  const recs = evaluateAll(ctx([session('s1', { prefixChange: 50000 })]), [boom, r1]);
  assert.deepEqual(recs.map(r => r.ruleId), ['R1']);
});

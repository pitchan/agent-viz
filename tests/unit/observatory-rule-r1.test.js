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

// The engine guarantees that each breakdown sums exactly to prefixChange, so
// the default puts every unclaimed token on modelSwitch: tests that say nothing
// about markers describe the pre-existing "model was switched" case.
function session(id, { project = 'F--proj', prefixChange = 0, compaction = 0, expiration = 0,
  toolsAppeared = 0, noMarker = 0, depth = null,
  netTokens = 100000, costUsd = 10, costComplete = true } = {}) {
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
        prefixBreakdown: {
          markers: {
            modelSwitch: { events: 1, tokens: prefixChange - toolsAppeared - noMarker },
            toolsAppeared: { events: 0, tokens: toolsAppeared },
            noMarker: { events: 0, tokens: noMarker },
          },
          noMarkerDetail: {
            earlyMcp: { events: 0, tokens: 0 },
            other: { events: 0, tokens: 0 },
          },
          depth: depth ?? {
            facade: { events: 0, tokens: 0 },
            d10to50: { events: 1, tokens: prefixChange },
            d50to90: { events: 0, tokens: 0 },
            tail: { events: 0, tokens: 0 },
          },
        },
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

// The action must follow the marker the engine actually journaled. On the
// 90-day history, the biggest project carries 25,26 M prefix-change tokens with
// modelSwitch at exactly 0: prescribing "start with the right model" there
// recommends a gesture the measurement refutes.
test('the action names the model switch only when that marker dominates', () => {
  const recs = r1.evaluate(ctx([session('s1', { prefixChange: 50000 })]));
  assert.equal(recs[0].evidence.dominantMarker, 'modelSwitch');
  assert.match(recs[0].action, /modèle/);
});

test('when nothing in the journal explains the break, R1 prescribes no gesture', () => {
  const recs = r1.evaluate(ctx([session('s1', { prefixChange: 50000, noMarker: 50000 })]));
  const switched = r1.evaluate(ctx([session('s1', { prefixChange: 50000 })]));
  assert.equal(recs[0].evidence.dominantMarker, 'noMarker');
  // The text may still name the model — to state it was measured at zero. What
  // it must not do is prescribe the gesture that belongs to the other marker.
  assert.notEqual(recs[0].action, switched[0].action);
  assert.doesNotMatch(recs[0].action, /Démarrer la session/,
    'a cause measured at zero must never be turned into a remedy');
  assert.match(recs[0].action, /non journalisée/);
  assert.match(recs[0].action, /Aucun geste/);
});

test('when deferred tools were loaded mid-session, the action names that cause', () => {
  const recs = r1.evaluate(ctx([session('s1', { prefixChange: 50000, toolsAppeared: 50000 })]));
  assert.equal(recs[0].evidence.dominantMarker, 'toolsAppeared');
  assert.match(recs[0].action, /outils/);
});

test('dominance is decided on the aggregate of the sessions that fired', () => {
  // s1 alone would read as a model switch; across the project noMarker wins.
  const recs = r1.evaluate(ctx([
    session('s1', { prefixChange: 30000 }),
    session('s2', { prefixChange: 50000, noMarker: 50000 }),
  ]));
  assert.equal(recs[0].evidence.dominantMarker, 'noMarker');
});

test('the evidence carries every marker, and they sum to the prefix-change tokens', () => {
  const recs = r1.evaluate(ctx([session('s1', { prefixChange: 50000, toolsAppeared: 5000, noMarker: 40000 })]));
  const { markerTokens, prefixChangeTokens } = recs[0].evidence;
  assert.deepEqual(markerTokens, { modelSwitch: 5000, toolsAppeared: 5000, noMarker: 40000 });
  const summed = Object.values(markerTokens).reduce((a, b) => a + b, 0);
  assert.equal(summed, prefixChangeTokens, 'the engine invariant must survive aggregation');
});

// Where the prefix breaks is the only thing left to say when no marker
// explains it — a "we do not know" card with no figure is worse than the bug.
test('the evidence carries where the prefix broke', () => {
  const recs = r1.evaluate(ctx([session('s1', {
    prefixChange: 50000, noMarker: 50000,
    depth: {
      facade: { events: 1, tokens: 10000 },
      d10to50: { events: 1, tokens: 35000 },
      d50to90: { events: 1, tokens: 5000 },
      tail: { events: 0, tokens: 0 },
    },
  })]));
  assert.equal(recs[0].evidence.dominantDepth, 'd10to50');
  assert.equal(recs[0].evidence.depthTokens.facade, 10000);
});

test('R1 evidence carries the noMarkerDetail ventilation in tokens', () => {
  const stat = (events, tokens) => ({ events, tokens });
  // Qualifying session: prefixChange dominant (40000 >= compaction and expiration)
  // and 40% of net (R1 threshold: 20%). The noMarker bucket splits 30000 / 10000.
  const session = {
    id: 'sess-early', project: 'F--dvf', netTokens: 100000, costUsd: 1, costComplete: true,
    report: { context: {
      churnCauses: {
        prefixChange: stat(1, 40000), compaction: stat(0, 0), expiration: stat(0, 0),
        growth: stat(0, 0), unknown: stat(0, 0),
      },
      prefixBreakdown: {
        markers: { modelSwitch: stat(0, 0), toolsAppeared: stat(0, 0), noMarker: stat(1, 40000) },
        noMarkerDetail: { earlyMcp: stat(2, 30000), other: stat(1, 10000) },
        depth: { facade: stat(1, 40000), d10to50: stat(0, 0), d50to90: stat(0, 0), tail: stat(0, 0) },
      },
    } },
  };
  const recs = r1.evaluate({ sessions: [session], configItems: [] });
  assert.equal(recs.length, 1);
  assert.deepEqual(recs[0].evidence.noMarkerDetailTokens, { earlyMcp: 30000, other: 10000 });
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

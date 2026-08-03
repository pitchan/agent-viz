'use strict';
// P3 cross-rule pointer: R1's cautious noMarker text gives way to a pointer
// at the project's R2 card — only under the three spec conditions, and the
// wording always carries the "étude" (correlation, not causation) label.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { applyCrossLinks, SEE_ALSO_ACTION } = require('../../lib/server/observatory/rules/cross-links');

const PRUDENT = 'Cause non journalisée : aucun geste recommandé.';

const r1 = over => ({
  ruleId: 'R1', subject: 'F--proj', action: PRUDENT,
  evidence: {
    dominantMarker: 'noMarker',
    markerTokens: { modelSwitch: 0, toolsAppeared: 0, noMarker: 100 },
    noMarkerDetailTokens: { earlyMcp: 60, other: 40 },
    ...over,
  },
});
const r2 = projects => ({ ruleId: 'R2', subject: 'srv@user', action: 'x', evidence: { projects } });

test('dominance + active R2 card on the same project → the pointer replaces the cautious text', () => {
  const out = applyCrossLinks([r1({}), r2(['F--proj'])]);
  assert.equal(out[0].action, SEE_ALSO_ACTION);
  assert.ok(SEE_ALSO_ACTION.includes('étude'), 'the study label is mandatory');
  assert.equal(out[1].action, 'x', 'R2 itself is untouched');
});

test('at exactly 50 % earlyMcp does not dominate', () => {
  const out = applyCrossLinks([r1({ noMarkerDetailTokens: { earlyMcp: 50, other: 50 } }), r2(['F--proj'])]);
  assert.equal(out[0].action, PRUDENT);
});

test('no R2 card for that project → cautious text stays', () => {
  const out = applyCrossLinks([r1({}), r2(['F--autre'])]);
  assert.equal(out[0].action, PRUDENT);
});

test('no R2 card at all → cautious text stays', () => {
  const out = applyCrossLinks([r1({})]);
  assert.equal(out[0].action, PRUDENT);
});

test('dominant marker other than noMarker → action untouched', () => {
  const out = applyCrossLinks([r1({ dominantMarker: 'modelSwitch' }), r2(['F--proj'])]);
  assert.equal(out[0].action, PRUDENT);
});

test('noMarker bucket at zero never divides, never links', () => {
  const out = applyCrossLinks([
    r1({ markerTokens: { modelSwitch: 0, toolsAppeared: 0, noMarker: 0 }, noMarkerDetailTokens: { earlyMcp: 0, other: 0 } }),
    r2(['F--proj']),
  ]);
  assert.equal(out[0].action, PRUDENT);
});

test('non-R1 recommendations pass through unchanged', () => {
  const r5 = { ruleId: 'R5', subject: 'F--proj', action: 'compacter moins', evidence: {} };
  assert.deepEqual(applyCrossLinks([r5, r2(['F--proj'])])[0], r5);
});

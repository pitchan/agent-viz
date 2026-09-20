// Cross-rule pointer: R1's cautious noMarker text gives way to a pointer at the
// project's R2 card — only under the three conditions of applyCrossLinks, and the
// wording always carries the "étude" (correlation, not causation) label.

import { expect, test } from 'vitest';
import { applyCrossLinks, SEE_ALSO_ACTION } from '../../src/server/observatory/rules/cross-links.ts';
import type { Recommendation } from '../../src/server/observatory/rules/types.ts';

const PRUDENT = 'Cause non journalisée : aucun geste recommandé.';

// Fixtures partielles : seuls les champs que applyCrossLinks lit vraiment
// (ruleId, subject, action, evidence) sont posés — jamais la forme complète
// d'un R1Recommendation/R2Recommendation, d'où le cast.
const r1 = (over: Record<string, unknown> = {}) => ({
  ruleId: 'R1', subject: 'F--proj', action: PRUDENT,
  evidence: {
    dominantMarker: 'noMarker',
    markerTokens: { modelSwitch: 0, toolsAppeared: 0, noMarker: 100 },
    noMarkerDetailTokens: { earlyMcp: 60, other: 40 },
    ...over,
  },
} as unknown as Recommendation);
const r2 = (projects: string[]) =>
  ({ ruleId: 'R2', subject: 'srv@user', action: 'x', evidence: { projects } } as unknown as Recommendation);

test('dominance + active R2 card on the same project → the pointer replaces the cautious text', () => {
  const out = applyCrossLinks([r1({}), r2(['F--proj'])]);
  expect(out[0]!.action).toBe(SEE_ALSO_ACTION);
  expect(SEE_ALSO_ACTION.includes('étude'), 'the study label is mandatory').toBeTruthy();
  expect(out[1]!.action, 'R2 itself is untouched').toBe('x');
});

test('at exactly 50 % earlyMcp does not dominate', () => {
  const out = applyCrossLinks([r1({ noMarkerDetailTokens: { earlyMcp: 50, other: 50 } }), r2(['F--proj'])]);
  expect(out[0]!.action).toBe(PRUDENT);
});

test('no R2 card for that project → cautious text stays', () => {
  const out = applyCrossLinks([r1({}), r2(['F--autre'])]);
  expect(out[0]!.action).toBe(PRUDENT);
});

test('no R2 card at all → cautious text stays', () => {
  const out = applyCrossLinks([r1({})]);
  expect(out[0]!.action).toBe(PRUDENT);
});

test('dominant marker other than noMarker → action untouched', () => {
  const out = applyCrossLinks([r1({ dominantMarker: 'modelSwitch' }), r2(['F--proj'])]);
  expect(out[0]!.action).toBe(PRUDENT);
});

test('noMarker bucket at zero never divides, never links', () => {
  const out = applyCrossLinks([
    r1({ markerTokens: { modelSwitch: 0, toolsAppeared: 0, noMarker: 0 }, noMarkerDetailTokens: { earlyMcp: 0, other: 0 } }),
    r2(['F--proj']),
  ]);
  expect(out[0]!.action).toBe(PRUDENT);
});

test('non-R1 recommendations pass through unchanged', () => {
  const r5 = { ruleId: 'R5', subject: 'F--proj', action: 'compacter moins', evidence: {} } as unknown as Recommendation;
  expect(applyCrossLinks([r5, r2(['F--proj'])])[0]).toEqual(r5);
});

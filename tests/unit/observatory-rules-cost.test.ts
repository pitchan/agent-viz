// Cost attribution. netgain prices a whole session; a rule needs the share
// that belongs to it. The only honest operation is the session's blended rate
// applied to tokens the rule can actually attribute.

import { expect, test } from 'vitest';
import { usdPerToken, usdForTokens, usdForBytes, sumUsd, BYTES_PER_TOKEN, COST_BASIS } from '../../src/server/observatory/rules/cost.ts';
import { THRESHOLDS, THRESHOLD_ORIGIN } from '../../src/server/observatory/rules/thresholds.ts';

const session = { netTokens: 1000, costUsd: 2, costComplete: true };

test('usdPerToken is the session blended rate', () => {
  expect(usdPerToken(session)).toBe(0.002);
});

test('a session with zero net tokens has a zero rate, never a division by zero', () => {
  expect(usdPerToken({ netTokens: 0, costUsd: 0 })).toBe(0);
  expect(usdForTokens({ netTokens: 0, costUsd: 0 }, 500)).toBe(0);
});

test('usdForTokens prices measured tokens at the session rate', () => {
  expect(usdForTokens(session, 250)).toBe(0.5);
});

test('usdForBytes converts through the named 4-bytes-per-token approximation', () => {
  expect(BYTES_PER_TOKEN).toBe(4);
  expect(usdForBytes(session, 4000)).toBe(usdForTokens(session, 1000));
});

test('sumUsd prices each session at its own rate — never a global rate', () => {
  expect(sumUsd([[session, 250], [{ netTokens: 100, costUsd: 1 }, 10]])).toBe(0.6);
  expect(sumUsd([])).toBe(0);
});

test('the three cost bases are distinct, explicit strings', () => {
  expect(COST_BASIS.MEASURED_TOKENS).toBe('jetons-mesures');
  expect(COST_BASIS.APPROX_BYTES).toBe('octets-approx-4o-par-jeton');
  // NOT_PRICED : décidé (BASIS_ORDER, ranking.ts) — R8/R9/R10 vont dans leur propre
  // bloc, jamais mêlées aux cartes chiffrées. Une quatrième base en redemande une.
  expect(COST_BASIS.NOT_PRICED).toBe('non-chiffre');
  expect(Object.keys(COST_BASIS).length, 'a fourth basis needs a ranking decision first').toBe(3);
});

test('every threshold declares where its value comes from', () => {
  const thresholds = THRESHOLDS as Record<string, Record<string, unknown>>;
  const origins = THRESHOLD_ORIGIN as Record<string, Record<string, unknown>>;
  for (const ruleId of Object.keys(thresholds)) {
    for (const key of Object.keys(thresholds[ruleId]!)) {
      expect(['spec', 'calibration'].includes(origins[ruleId]![key] as string), `${ruleId}.${key} must declare 'spec' or 'calibration'`).toBeTruthy();
    }
  }
});

test('the thresholds fixed by the spec are exactly the spec values', () => {
  expect(THRESHOLDS.R2.minLoadedShare).toBe(0.5);
  expect(THRESHOLDS.R2.maxUsedShare).toBe(0.1);
  expect(THRESHOLDS.R5.minCompactions).toBe(2);
  expect(THRESHOLDS.R6.maxDurationMs).toBe(5 * 60 * 1000);
  expect(THRESHOLDS.R6.minSubagentShare).toBe(0.3);
});

// The seven calibrated values are pinned, not just declared 'calibration': they
// come from a measurement on 90 days of real history (docs/sources-externes.md),
// and changing one silently would change which advice a user is given.
test('the calibrated thresholds are exactly the values the measurement retained', () => {
  expect(THRESHOLDS.R1.minShareOfNet, 'at 0.05 the rule would flag 9 projects out of 14').toBe(0.20);
  expect(THRESHOLDS.R3.minShareOfToolBytes).toBe(0.05);
  expect(THRESHOLDS.R3.minCount).toBe(5);
  expect(THRESHOLDS.R4.minShareOfReadBytes).toBe(0.05);
  expect(THRESHOLDS.R4.minBytes).toBe(100 * 1024);
  expect(THRESHOLDS.R7.minEditsAfterLastVerification, 'p50 de queue = 4, une queue de 1 pese 13 pourcent des cas').toBe(1);
  expect(THRESHOLDS.R7.minSessions, 'a 2 la regle marque 3 projets sur 4, a 3 elle en marque 2/4 et couvre 94,6 pourcent des jetons a risque').toBe(3);
});

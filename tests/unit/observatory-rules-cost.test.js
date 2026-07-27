'use strict';
// Cost attribution. netgain prices a whole session; a rule needs the share
// that belongs to it. The only honest operation is the session's blended rate
// applied to tokens the rule can actually attribute.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { usdPerToken, usdForTokens, usdForBytes, sumUsd, BYTES_PER_TOKEN, COST_BASIS }
  = require('../../lib/server/observatory/rules/cost');
const { THRESHOLDS, THRESHOLD_ORIGIN } = require('../../lib/server/observatory/rules/thresholds');

const session = { netTokens: 1000, costUsd: 2, costComplete: true };

test('usdPerToken is the session blended rate', () => {
  assert.equal(usdPerToken(session), 0.002);
});

test('a session with zero net tokens has a zero rate, never a division by zero', () => {
  assert.equal(usdPerToken({ netTokens: 0, costUsd: 0 }), 0);
  assert.equal(usdForTokens({ netTokens: 0, costUsd: 0 }, 500), 0);
});

test('usdForTokens prices measured tokens at the session rate', () => {
  assert.equal(usdForTokens(session, 250), 0.5);
});

test('usdForBytes converts through the named 4-bytes-per-token approximation', () => {
  assert.equal(BYTES_PER_TOKEN, 4);
  assert.equal(usdForBytes(session, 4000), usdForTokens(session, 1000));
});

test('sumUsd prices each session at its own rate — never a global rate', () => {
  assert.equal(sumUsd([[session, 250], [{ netTokens: 100, costUsd: 1 }, 10]]), 0.6);
  assert.equal(sumUsd([]), 0);
});

test('the two cost bases are distinct, explicit strings', () => {
  assert.equal(COST_BASIS.MEASURED_TOKENS, 'jetons-mesures');
  assert.equal(COST_BASIS.APPROX_BYTES, 'octets-approx-4o-par-jeton');
  assert.equal(Object.keys(COST_BASIS).length, 2, 'a third basis needs a ranking decision first');
});

test('every threshold declares where its value comes from', () => {
  for (const ruleId of Object.keys(THRESHOLDS)) {
    for (const key of Object.keys(THRESHOLDS[ruleId])) {
      assert.ok(['spec', 'calibration'].includes(THRESHOLD_ORIGIN[ruleId][key]),
        `${ruleId}.${key} must declare 'spec' or 'calibration'`);
    }
  }
});

test('the thresholds fixed by the spec are exactly the spec values', () => {
  assert.equal(THRESHOLDS.R2.minLoadedShare, 0.5);
  assert.equal(THRESHOLDS.R2.maxUsedShare, 0.1);
  assert.equal(THRESHOLDS.R5.minCompactions, 2);
  assert.equal(THRESHOLDS.R6.maxDurationMs, 5 * 60 * 1000);
  assert.equal(THRESHOLDS.R6.minSubagentShare, 0.3);
});

// The five calibrated values are pinned here, not just declared as
// 'calibration'. They are the outcome of a measurement on 90 days of real
// history (netgain/docs/calibration-observatoire-m1.md): changing one silently
// would change which advice a user is given, with no trace of why.
test('the calibrated thresholds are exactly the values the measurement retained', () => {
  assert.equal(THRESHOLDS.R1.minShareOfNet, 0.20,
    'raised from the 0.05 first proposed: 0.05 flagged 9 projects out of 14');
  assert.equal(THRESHOLDS.R3.minShareOfToolBytes, 0.05);
  assert.equal(THRESHOLDS.R3.minCount, 5);
  assert.equal(THRESHOLDS.R4.minShareOfReadBytes, 0.05);
  assert.equal(THRESHOLDS.R4.minBytes, 100 * 1024);
});

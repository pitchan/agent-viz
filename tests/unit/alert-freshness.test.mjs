// Freshness is a display rule, not a detection rule.
//
// The watchdog records every alert with the real time of its triggering
// event: a journal that dropped the last hour would be no journal. What must
// not happen is the badge lighting up for something that ended an hour ago.
// So the cut happens at the moment of showing — here, and only here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isFresh, FRESHNESS_MS } from '../../public/viz-alert-freshness.mjs';

const T = 1_700_000_000_000;

test('une alerte de l instant est fraiche', () => {
  assert.equal(isFresh({ createdAt: T }, T), true);
});

test('une alerte a la limite exacte est encore fraiche', () => {
  assert.equal(isFresh({ createdAt: T - FRESHNESS_MS }, T), true);
});

test('une alerte plus vieille que la fenetre ne l est plus', () => {
  assert.equal(isFresh({ createdAt: T - FRESHNESS_MS - 1 }, T), false);
});

test('la fenetre est reglable, la valeur par defaut ne fuit pas', () => {
  assert.equal(isFresh({ createdAt: T - 10_000 }, T, 5_000), false);
  assert.equal(isFresh({ createdAt: T - 10_000 }, T, 60_000), true);
});

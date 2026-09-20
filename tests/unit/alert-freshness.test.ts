// Freshness is a display rule, not a detection rule.
//
// The watchdog records every alert with the real time of its triggering
// event: a journal that dropped the last hour would be no journal. What must
// not happen is the badge lighting up for something that ended an hour ago.
// So the cut happens at the moment of showing — here, and only here.

import { expect, test } from 'vitest';
import { isFresh, FRESHNESS_MS } from '../../src/web/viz-alert-freshness.ts';

const T = 1_700_000_000_000;

test('une alerte de l instant est fraiche', () => {
  expect(isFresh({ createdAt: T, standing: false }, T)).toBe(true);
});

test('une alerte a la limite exacte est encore fraiche', () => {
  expect(isFresh({ createdAt: T - FRESHNESS_MS, standing: false }, T)).toBe(true);
});

test('une alerte plus vieille que la fenetre ne l est plus', () => {
  expect(isFresh({ createdAt: T - FRESHNESS_MS - 1, standing: false }, T)).toBe(false);
});

test('la fenetre est reglable, la valeur par defaut ne fuit pas', () => {
  expect(isFresh({ createdAt: T - 10_000, standing: false }, T, 5_000)).toBe(false);
  expect(isFresh({ createdAt: T - 10_000, standing: false }, T, 60_000)).toBe(true);
});

// A standing alert describes a state, not a moment: it is worth showing for as
// long as the state holds, and what ends it is the detector withdrawing it —
// never the clock. Same createdAt, same now: only the flag separates them.
test('une alerte d etat n a pas de date de peremption', () => {
  const old = T - 3_600_000;
  expect(isFresh({ createdAt: old, standing: true }, T)).toBe(true);
  expect(isFresh({ createdAt: old, standing: false }, T),
    'controle negatif : c est bien le drapeau qui fait la difference, pas l heure').toBe(false);
});

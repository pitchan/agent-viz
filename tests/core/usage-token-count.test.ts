// isTokenCount et countOrZero partagent une seule définition du compte de jetons :
// un entier >= 0. Les deux tables de tests/helpers/token-counts.ts SONT cette définition.
import { expect, test } from 'vitest';
import { countOrZero, isTokenCount } from '../../src/engine/core/usage.ts';
import { COMPTES, PAS_DES_COMPTES } from '../helpers/token-counts.ts';

test.each(COMPTES)('%s est un compte', (_label, valeur) => {
  expect(isTokenCount(valeur)).toBe(true);
});

test.each(PAS_DES_COMPTES)('%s n\'est pas un compte', (_label, valeur) => {
  expect(isTokenCount(valeur)).toBe(false);
});

test.each(COMPTES)('%s vaut sa valeur', (_label, valeur) => {
  expect(countOrZero(valeur)).toBe(valeur);
});

test.each(PAS_DES_COMPTES)('%s vaut zero', (_label, valeur) => {
  expect(countOrZero(valeur)).toBe(0);
});

// pricingKindOf est la contrepartie qualitative de computeCost : il dit tarifé, zéro
// voulu ou inconnu là où computeCost rend un montant ou null.
import { expect, test } from 'vitest';
import { pricingKindOf } from '../../src/engine/core/pricing.ts';

test('tarifé / zéro voulu / inconnu', () => {
  expect(pricingKindOf('claude-opus-4-8')).toBe('tarife');
  expect(pricingKindOf('claude-sonnet-5', '2026-08-15T00:00:00.000Z')).toBe('tarife');
  expect(pricingKindOf('<synthetic>')).toBe('zero-voulu');
  expect(pricingKindOf('ministral-3:latest')).toBe('zero-voulu');
  expect(pricingKindOf('claude-futur-9')).toBe('inconnu');
  expect(pricingKindOf(null)).toBe('inconnu');
});

test("la normalisation s'applique comme dans computeCost", () => {
  expect(pricingKindOf('anthropic/claude-opus-4-8')).toBe('tarife');
  expect(pricingKindOf('claude-fable-5[1m]')).toBe('tarife');
});

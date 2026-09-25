// pricingKindOf est la contrepartie qualitative de computeCost : il dit tarifé, zéro
// voulu ou inconnu là où computeCost rend un montant ou null.
import { expect, test } from 'vitest';
import { pricingKindOf } from '../../src/engine/core/pricing.ts';

test('tarifé / zéro voulu / inconnu', () => {
  expect(pricingKindOf('claude-opus-4-8', undefined, undefined)).toBe('tarife');
  expect(pricingKindOf('claude-sonnet-5', '2026-08-15T00:00:00.000Z', undefined)).toBe('tarife');
  expect(pricingKindOf('<synthetic>', undefined, undefined)).toBe('zero-voulu');
  expect(pricingKindOf('ministral-3:latest', undefined, undefined)).toBe('zero-voulu');
  expect(pricingKindOf('claude-futur-9', undefined, undefined)).toBe('inconnu');
  expect(pricingKindOf(null, undefined, undefined)).toBe('inconnu');
});

test("la normalisation s'applique comme dans computeCost", () => {
  expect(pricingKindOf('anthropic/claude-opus-4-8', undefined, undefined)).toBe('tarife');
  expect(pricingKindOf('claude-fable-5[1m]', undefined, undefined)).toBe('tarife');
});

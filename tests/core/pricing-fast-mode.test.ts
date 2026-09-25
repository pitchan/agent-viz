// Le mode rapide se lit dans `usage.speed`, la vitesse réellement servie : seul
// `"fast"` change le tarif, et un modèle sans tarif rapide n'est jamais facturé
// au tarif normal en silence.
import { expect, test } from 'vitest';
import { computeCost, pricingKindOf, priceTable } from '../../src/engine/core/pricing.ts';

const USAGE = {
  input_tokens: 1000,
  output_tokens: 2000,
  cache_creation_input_tokens: 10000,
  cache_read_input_tokens: 100000,
  cache_creation: { ephemeral_5m_input_tokens: 4000, ephemeral_1h_input_tokens: 6000 },
};

test('Opus 5.5 en mode rapide coûte exactement le double, cache compris', () => {
  // Arrange
  const usage = { ...USAGE, speed: 'fast' };

  // Act
  const r = computeCost(usage, 'claude-opus-5-5');

  // Assert
  // 1000×8e-6 + 2000×4e-5 + 4000×1e-5 + 6000×(8e-6×2) + 100000×4e-7
  // = 0.008 + 0.08 + 0.04 + 0.096 + 0.04 = 0.264, soit 2 × 0.132 au tarif normal
  expect(r.usd).toBeCloseTo(0.264, 12);
});

test('Opus 5.5 en vitesse standard garde le tarif normal', () => {
  // Arrange
  const usage = { ...USAGE, speed: 'standard' };

  // Act
  const r = computeCost(usage, 'claude-opus-5-5');

  // Assert
  expect(r.usd).toBeCloseTo(0.132, 12);
});

test('Opus 5 en mode rapide : 10 $ / 50 $, cache 1 h à 2 × 10 $', () => {
  // Arrange
  const usage = {
    input_tokens: 1000, output_tokens: 1000, cache_creation_input_tokens: 1000,
    cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 1000 },
    speed: 'fast',
  };

  // Act
  const r = computeCost(usage, 'claude-opus-5');

  // Assert
  // 1000×1e-5 + 1000×5e-5 + 1000×2e-5 = 0.08
  expect(r.usd).toBeCloseTo(0.08, 12);
});

test('speed null ou absent : tarif normal', () => {
  expect(computeCost({ input_tokens: 1000, speed: null }, 'claude-opus-5-5').usd).toBeCloseTo(0.004, 12);
  expect(computeCost({ input_tokens: 1000 }, 'claude-opus-5-5').usd).toBeCloseTo(0.004, 12);
});

test('mode rapide sur un modèle sans tarif rapide : coût inconnu, modèle nommé', () => {
  expect(computeCost({ input_tokens: 1000, speed: 'fast' }, 'claude-sonnet-5'))
    .toEqual({ usd: null, known: false, model: 'claude-sonnet-5' });
  expect(computeCost({ input_tokens: 1000, speed: 'fast' }, 'claude-opus-4-6').usd).toBeNull();
});

test('un modèle à zéro voulu reste à zéro en mode rapide', () => {
  expect(computeCost({ input_tokens: 1000, speed: 'fast' }, '<synthetic>').usd).toBe(0);
});

test('pricingKindOf suit la même règle que computeCost', () => {
  expect(pricingKindOf('claude-opus-5-5', undefined, 'fast')).toBe('tarife');
  expect(pricingKindOf('claude-sonnet-5', undefined, 'fast')).toBe('inconnu');
  expect(pricingKindOf('claude-sonnet-5', undefined, 'standard')).toBe('tarife');
});

test('la table affichée porte le tarif rapide, null sans mode rapide', () => {
  // Arrange
  const entries = priceTable().entries;

  // Act
  const opus = entries.find((e) => e.model === 'claude-opus-5-5');
  const sonnet = entries.find((e) => e.model === 'claude-sonnet-5');

  // Assert
  expect(opus?.fast).toEqual({ input: 8e-6, output: 4e-5, cacheCreate: 1e-5, cacheRead: 4e-7 });
  expect(sonnet?.fast).toBeNull();
});

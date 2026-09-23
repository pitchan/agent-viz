// Le barème courant du serveur : un prix appliqué se voit tout de suite dans la carte de prix.
import { afterEach, expect, test } from 'vitest';
import { applyAdoptedPrices, currentPricing } from '../../src/server/pricing-state.ts';
import { getPrice } from '../../src/server/pricing.ts';

const OPUS_5_5 = { 'claude-opus-6': [{
  prices: { input: 4e-6, output: 2e-5, cacheCreate: 5e-6, cacheRead: 2e-7 },
  maxInput: 1_000_000, from: null, replaces: null, adoptedAt: '2026-09-23T10:00:00.000Z', source: 'litellm' as const,
}] };

// Le détenteur est un état de module : chaque test repart de la table embarquée.
afterEach(() => applyAdoptedPrices({}));

test('après application, la carte de prix connaît le modèle adopté', () => {
  // Arrange
  applyAdoptedPrices(OPUS_5_5);

  // Act
  const p = getPrice('claude-opus-6');

  // Assert
  expect(p).toMatchObject({ input: 4e-6, label: 'Opus 6', maxInput: 1_000_000 });
});

test('après application, le coût courant chiffre le modèle adopté', () => {
  // Arrange
  applyAdoptedPrices(OPUS_5_5);

  // Act
  const r = currentPricing().computeCost({ input_tokens: 1_000_000 }, 'claude-opus-6');

  // Assert
  expect(r.usd).toBeCloseTo(4, 12);
});

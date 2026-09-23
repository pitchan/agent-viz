// L'agrégateur de jetons chiffre au barème qu'on lui donne : un modèle adopté y est tarifé.
import { expect, test } from 'vitest';
import { createPricing } from '../../src/engine/core/pricing.ts';
import { TokensAggregator } from '../../src/engine/doctor/aggregators/tokens.ts';
import { assistant } from '../helpers/tokens-events.ts';

test('un modèle adopté rend la session complète et chiffrée', () => {
  // Arrange
  const pricing = createPricing({ 'claude-opus-5-5': [{
    prices: { input: 4e-6, output: 2e-5, cacheCreate: 5e-6, cacheRead: 2e-7 },
    maxInput: 1_000_000, from: null, replaces: null, adoptedAt: '2026-09-23T10:00:00.000Z', source: 'litellm',
  }] });
  const agg = new TokensAggregator(pricing);
  agg.addAssistant(assistant({ msgId: 'm1', model: 'claude-opus-5-5', usage: { input_tokens: 1_000_000 } }), 'main');

  // Act
  const r = agg.result();

  // Assert
  expect(r.costComplete).toBe(true);
  expect(r.costUsd).toBeCloseTo(4, 12);
});

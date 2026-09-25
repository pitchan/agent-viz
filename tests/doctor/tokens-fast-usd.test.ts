// fastUsd dit combien ont coûté les messages servis en mode rapide ; il est
// compris dans usd, jamais ajouté une seconde fois.
import { expect, test } from 'vitest';
import { embeddedPricing } from '../../src/engine/core/pricing.ts';
import { TokensAggregator } from '../../src/engine/doctor/aggregators/tokens.ts';
import { assistant } from '../helpers/tokens-events.ts';

test('fastUsd compte les seuls messages rapides, déjà inclus dans usd', () => {
  // Arrange
  const agg = new TokensAggregator(embeddedPricing);
  agg.addAssistant(assistant({ msgId: 'f1', model: 'claude-opus-5-5', usage: { input_tokens: 1000, speed: 'fast' } }), 'main');
  agg.addAssistant(assistant({ msgId: 's1', model: 'claude-opus-5-5', usage: { input_tokens: 1000, speed: 'standard' } }), 'main');

  // Act
  const opus = agg.result().costByModel['claude-opus-5-5'];

  // Assert
  // rapide : 1000×8e-6 = 0.008 ; normal : 1000×4e-6 = 0.004
  expect(opus?.fastUsd).toBeCloseTo(0.008, 12);
  expect(opus?.usd).toBeCloseTo(0.012, 12);
});

test('un message rapide sans tarif rapide ne compte pas dans fastUsd et rend le coût partiel', () => {
  // Arrange
  const agg = new TokensAggregator(embeddedPricing);
  agg.addAssistant(assistant({ msgId: 'f2', model: 'claude-sonnet-5', usage: { input_tokens: 1000, speed: 'fast' } }), 'main');

  // Act
  const r = agg.result();

  // Assert
  expect(r.costByModel['claude-sonnet-5']?.fastUsd).toBe(0);
  expect(r.unknownModels).toEqual(['claude-sonnet-5']);
  expect(r.costComplete).toBe(false);
});

test('un seul message au tarif inconnu rend la ligne du modèle inconnue', () => {
  // Arrange
  const agg = new TokensAggregator(embeddedPricing);
  agg.addAssistant(assistant({ msgId: 's3', model: 'claude-sonnet-5', usage: { input_tokens: 1000, speed: 'standard' } }), 'main');
  agg.addAssistant(assistant({ msgId: 'f3', model: 'claude-sonnet-5', usage: { input_tokens: 1000, speed: 'fast' } }), 'main');

  // Act
  const sonnet = agg.result().costByModel['claude-sonnet-5'];

  // Assert
  expect(sonnet?.pricing).toBe('inconnu');
});

// La pastille en direct lit la vitesse comme le moteur : tarif rapide appliqué,
// et un « rapide » sans tarif rapide rend le total partiel, modèle nommé.
import { expect, test } from 'vitest';
import { newBucket, accumulateUsage } from '../../src/server/tokens.ts';

test('un message rapide Opus 5.5 est compté au tarif rapide', () => {
  // Arrange
  const b = newBucket();

  // Act
  accumulateUsage(b, { input_tokens: 1000, output_tokens: 0, speed: 'fast' }, 'claude-opus-5-5', 'm1', null);

  // Assert
  expect(b.costUsd).toBeCloseTo(0.008, 12);
});

test('un message rapide sans tarif rapide rend le total partiel', () => {
  // Arrange
  const b = newBucket();

  // Act
  accumulateUsage(b, { input_tokens: 1000, output_tokens: 0, speed: 'fast' }, 'claude-sonnet-5', 'm2', null);

  // Assert
  expect(b.costComplete).toBe(false);
  expect(b.unknownModels).toEqual(['claude-sonnet-5']);
});

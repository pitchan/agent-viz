// Le tarif par longueur de prompt se décide appel par appel : un appel passé au tarif court
// garde son coût quand un appel suivant de la même session dépasse le seuil.
import { expect, test } from 'vitest';
import { newBucket, accumulateUsage } from '../../src/server/tokens.ts';

test('un appel au prompt long ne renchérit pas l’appel court qui le précède', () => {
  // Arrange
  const b = newBucket();
  accumulateUsage(b, { input_tokens: 80_000, output_tokens: 0 }, 'claude-haiku-5-5', 'm1', null);
  const coutDuPremier = b.costUsd;

  // Act
  accumulateUsage(b, { input_tokens: 120_000, output_tokens: 0 }, 'claude-haiku-5-5', 'm2', null);

  // Assert
  expect(coutDuPremier).toBeCloseTo(80_000 * 0.10 / 1e6, 12);
  expect(b.costUsd).toBeCloseTo(80_000 * 0.10 / 1e6 + 120_000 * 0.50 / 1e6, 12);
});

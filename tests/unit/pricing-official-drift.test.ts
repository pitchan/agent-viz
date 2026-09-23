// La comparaison entre le barème du serveur et la page des tarifs d'Anthropic :
// un modèle plus récent que ceux de sa famille, ou un tarif changé, fait un écart ;
// les modèles retirés que la page liste encore n'en font pas.
import { afterEach, expect, test } from 'vitest';
import { _internals } from '../../src/server/pricing.ts';
import { applyAdoptedPrices } from '../../src/server/pricing-state.ts';
import type { ModelPrices } from '../../src/engine/core/pricing.ts';

const OPUS_5: ModelPrices = { input: 5e-6, output: 2.5e-5, cacheCreate: 6.25e-6, cacheRead: 5e-7 };
const OPUS_6: ModelPrices = { input: 6e-6, output: 3e-5, cacheCreate: 7.5e-6, cacheRead: 6e-7 };
const page = (entries: [string, ModelPrices][]) => new Map(entries);

// Le barème du serveur est un état de module : chaque test repart de la table embarquée.
afterEach(() => applyAdoptedPrices({}));

test('une page identique au barème ne fait aucun écart', () => {
  // Arrange
  const officiel = page([['claude-opus-5', OPUS_5]]);

  // Act
  const drifts = _internals.officialDrift(officiel, new Map());

  // Assert
  expect(drifts).toEqual([]);
});

test('un modèle plus récent que sa famille est nouveau, avec la fenêtre de la page des modèles', () => {
  // Arrange
  const officiel = page([['claude-opus-6', OPUS_6]]);

  // Act
  const drifts = _internals.officialDrift(officiel, new Map([['claude-opus-6', 1_000_000]]));

  // Assert
  expect(drifts).toEqual([{ model: 'claude-opus-6', kind: 'modele-nouveau', official: OPUS_6, embedded: null, maxInput: 1_000_000 }]);
});

test('un modèle nouveau absent de la page des modèles porte une fenêtre inconnue', () => {
  // Arrange
  const officiel = page([['claude-opus-6', OPUS_6]]);

  // Act
  const drifts = _internals.officialDrift(officiel, new Map());

  // Assert
  expect(drifts[0]?.maxInput).toBeNull();
});

test('un modèle retiré, plus ancien que le plus récent de sa famille, ne fait pas d’écart', () => {
  // Arrange
  const officiel = page([['claude-opus-4-1', { input: 1.5e-5, output: 7.5e-5, cacheCreate: 1.875e-5, cacheRead: 1.5e-6 }]]);

  // Act
  const drifts = _internals.officialDrift(officiel, new Map());

  // Assert
  expect(drifts).toEqual([]);
});

test('un tarif changé sur un modèle connu est un écart, qui garde la fenêtre du barème', () => {
  // Arrange
  const nouveau = { ...OPUS_5, input: 4e-6 };
  const officiel = page([['claude-opus-5', nouveau]]);

  // Act
  const drifts = _internals.officialDrift(officiel, new Map());

  // Assert
  expect(drifts).toEqual([{ model: 'claude-opus-5', kind: 'tarif-different', official: nouveau, embedded: OPUS_5, maxInput: 1_000_000 }]);
});

test('un modèle déjà adopté n’est plus un écart', () => {
  // Arrange
  applyAdoptedPrices({ 'claude-opus-6': [{ prices: OPUS_6, maxInput: 1_000_000, from: null, replaces: null, adoptedAt: '2026-09-23T00:00:00.000Z', source: 'anthropic' }] });
  const officiel = page([['claude-opus-6', OPUS_6]]);

  // Act
  const drifts = _internals.officialDrift(officiel, new Map());

  // Assert
  expect(drifts).toEqual([]);
});

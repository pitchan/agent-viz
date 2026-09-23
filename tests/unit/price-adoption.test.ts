// Adopter : le prix vient de la dérive gardée par la vigie, s'ajoute au fichier,
// et devient le barème courant. Rien ne vient de l'appelant, sauf le nom du modèle.
import { expect, test } from 'vitest';
import { createPriceAdoption } from '../../src/server/price-adoption.ts';
import type { AdoptedPrices } from '../../src/engine/core/pricing.ts';
import type { KnownDrift } from '../../src/server/pricing.ts';

const P = { input: 4e-6, output: 2e-5, cacheCreate: 5e-6, cacheRead: 2e-7 };
const OPUS_5 = { input: 5e-6, output: 2.5e-5, cacheCreate: 6.25e-6, cacheRead: 5e-7 };
const NOW = new Date('2026-09-23T12:00:00.000Z');

const nouveau = (): KnownDrift => ({
  model: 'claude-opus-5-5', kind: 'modele-nouveau', litellm: P, embedded: null,
  maxInput: 1_000_000, firstSeenAt: '2026-09-22T00:00:00.000Z',
});

function deps(drift: KnownDrift | null, fichier: AdoptedPrices = {}) {
  const ecrit: AdoptedPrices[] = [];
  const applique: AdoptedPrices[] = [];
  const oublie: string[] = [];
  return {
    ecrit, applique, oublie,
    adoption: createPriceAdoption({
      driftFor: () => drift,
      forgetDrift: (m) => { oublie.push(m); },
      read: async () => fichier,
      write: async (a) => { ecrit.push(a); },
      apply: (a) => { applique.push(a); },
      now: () => NOW,
    }),
  };
}

test('un modèle nouveau est écrit sans date de départ ni tarif remplacé', async () => {
  // Arrange
  const d = deps(nouveau());

  // Act
  await d.adoption.adopt('claude-opus-5-5');

  // Assert
  expect(d.ecrit[0]?.['claude-opus-5-5']).toEqual([{
    prices: P, maxInput: 1_000_000, from: null, replaces: null,
    adoptedAt: '2026-09-23T12:00:00.000Z', source: 'litellm',
  }]);
});

test('un tarif différent part de la première détection et nomme le tarif remplacé', async () => {
  // Arrange
  const d = deps({ ...nouveau(), model: 'claude-opus-5', kind: 'tarif-different', embedded: OPUS_5 });

  // Act
  const r = await d.adoption.adopt('claude-opus-5');

  // Assert
  expect(r).toEqual({ model: 'claude-opus-5', kind: 'tarif-different', from: '2026-09-22T00:00:00.000Z' });
  expect(d.ecrit[0]?.['claude-opus-5']?.[0]).toMatchObject({ from: '2026-09-22T00:00:00.000Z', replaces: OPUS_5 });
});

test('l’adoption s’ajoute aux entrées déjà présentes dans le fichier', async () => {
  // Arrange
  const existant: AdoptedPrices = { 'claude-x-1': [{ prices: P, maxInput: 1, from: null, replaces: null, adoptedAt: '2026-01-01T00:00:00.000Z', source: 'litellm' }] };
  const d = deps(nouveau(), existant);

  // Act
  await d.adoption.adopt('claude-opus-5-5');

  // Assert
  expect(Object.keys(d.ecrit[0] ?? {}).sort()).toEqual(['claude-opus-5-5', 'claude-x-1']);
});

test('le barème appliqué est celui écrit, et la dérive est oubliée', async () => {
  // Arrange
  const d = deps(nouveau());

  // Act
  await d.adoption.adopt('claude-opus-5-5');

  // Assert
  expect(d.applique).toEqual(d.ecrit);
  expect(d.oublie).toEqual(['claude-opus-5-5']);
});

test('un modèle sans dérive connue rend null et n’écrit rien', async () => {
  // Arrange
  const d = deps(null);

  // Act
  const r = await d.adoption.adopt('claude-opus-5-5');

  // Assert
  expect(r).toBeNull();
  expect(d.ecrit).toEqual([]);
});

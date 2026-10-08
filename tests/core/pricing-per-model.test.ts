// Le tarif de chaque modèle de la table, champ par champ : un million de jetons d'une seule
// sorte coûte le prix au million de cette sorte. Les prix sont écrits en littéral, en dollars
// par million : lus de la table, ils ne rougiraient pas quand un tarif y change.
import { expect, test } from 'vitest';
import { computeCost, priceTable } from '../../src/engine/core/pricing.ts';

const MILLION = 1_000_000;
const DATE = '2026-10-01T00:00:00.000Z';

interface Tarif { entree: number; sortie: number; ecritureCache: number; relectureCache: number }

const TARIFS: Record<string, Tarif> = {
  'claude-fable-5': { entree: 10, sortie: 50, ecritureCache: 12.5, relectureCache: 1 },
  'claude-fable-5-1': { entree: 10, sortie: 50, ecritureCache: 12.5, relectureCache: 0.25 },
  'claude-mythos-5': { entree: 10, sortie: 50, ecritureCache: 12.5, relectureCache: 1 },
  'claude-mythos-5-1': { entree: 10, sortie: 50, ecritureCache: 12.5, relectureCache: 0.25 },
  'claude-opus-5-5': { entree: 4, sortie: 20, ecritureCache: 5, relectureCache: 0.2 },
  'claude-opus-5': { entree: 5, sortie: 25, ecritureCache: 6.25, relectureCache: 0.5 },
  'claude-sonnet-5': { entree: 2, sortie: 10, ecritureCache: 2.5, relectureCache: 0.2 },
  'claude-opus-4-8': { entree: 5, sortie: 25, ecritureCache: 6.25, relectureCache: 0.5 },
  'claude-opus-4-7': { entree: 5, sortie: 25, ecritureCache: 6.25, relectureCache: 0.5 },
  'claude-opus-4-6': { entree: 5, sortie: 25, ecritureCache: 6.25, relectureCache: 0.5 },
  'claude-opus-4-5': { entree: 5, sortie: 25, ecritureCache: 6.25, relectureCache: 0.5 },
  'claude-sonnet-4-6': { entree: 3, sortie: 15, ecritureCache: 3.75, relectureCache: 0.3 },
  'claude-sonnet-4-5': { entree: 3, sortie: 15, ecritureCache: 3.75, relectureCache: 0.3 },
  'claude-haiku-4-5': { entree: 1, sortie: 5, ecritureCache: 1.25, relectureCache: 0.1 },
  'gpt-6-astra': { entree: 10, sortie: 50, ecritureCache: 12.5, relectureCache: 1 },
  'gpt-6.1-sol': { entree: 2, sortie: 10, ecritureCache: 2.5, relectureCache: 0.1 },
  'gpt-5.6-sol': { entree: 4, sortie: 20, ecritureCache: 5, relectureCache: 0.4 },
  'gpt-5.6-terra': { entree: 2, sortie: 12, ecritureCache: 2.5, relectureCache: 0.2 },
  'gpt-5.6-luna': { entree: 0.2, sortie: 1.2, ecritureCache: 0.25, relectureCache: 0.02 },
};

const MODELES = Object.entries(TARIFS).map(([modele, tarif]) => ({ modele, ...tarif }));

test.each(MODELES)('$modele : un million de jetons d’entrée coûte $entree $', ({ modele, entree }) => {
  expect(computeCost({ input_tokens: MILLION }, modele, DATE).usd).toBeCloseTo(entree, 9);
});

test.each(MODELES)('$modele : un million de jetons de sortie coûte $sortie $', ({ modele, sortie }) => {
  expect(computeCost({ output_tokens: MILLION }, modele, DATE).usd).toBeCloseTo(sortie, 9);
});

test.each(MODELES)('$modele : un million de jetons écrits en cache coûte $ecritureCache $', ({ modele, ecritureCache }) => {
  expect(computeCost({ cache_creation_input_tokens: MILLION }, modele, DATE).usd).toBeCloseTo(ecritureCache, 9);
});

test.each(MODELES)('$modele : un million de jetons relus du cache coûte $relectureCache $', ({ modele, relectureCache }) => {
  expect(computeCost({ cache_read_input_tokens: MILLION }, modele, DATE).usd).toBeCloseTo(relectureCache, 9);
});

test.each(MODELES)('$modele : un million de jetons écrits en cache une heure coûte deux fois l’entrée', ({ modele, entree }) => {
  // Arrange
  const usage = {
    cache_creation_input_tokens: MILLION,
    cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: MILLION },
  };
  // Act
  const cout = computeCost(usage, modele, DATE);
  // Assert
  expect(cout.usd).toBeCloseTo(entree * 2, 9);
});

test.each(MODELES)('$modele : un appel qui mêle les quatre sortes de jetons coûte la somme des quatre', (m) => {
  // Arrange
  const usage = {
    input_tokens: 1200, output_tokens: 340, cache_creation_input_tokens: 5600, cache_read_input_tokens: 78_000,
  };
  const attendu = (1200 * m.entree + 340 * m.sortie + 5600 * m.ecritureCache + 78_000 * m.relectureCache) / MILLION;
  // Act
  const cout = computeCost(usage, m.modele, DATE);
  // Assert
  expect(cout.usd).toBeCloseTo(attendu, 12);
});

test('chaque modèle de la table a son tarif vérifié ici', () => {
  expect(priceTable().entries.map((e) => e.model).sort()).toEqual(Object.keys(TARIFS).sort());
});

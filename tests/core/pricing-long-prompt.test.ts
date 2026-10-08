// Haiku 5.5 est tarifé par longueur de prompt : jusqu'à 100 000 jetons de prompt un tarif,
// au-delà un autre, appliqué à tous les jetons de l'appel. Les prix sont écrits en littéral,
// en dollars par million, repris de la page des tarifs d'Anthropic.
import { expect, test } from 'vitest';
import { computeCost } from '../../src/engine/core/pricing.ts';

const MODELE = 'claude-haiku-5-5';
const SEUIL = 100_000;
const MILLION = 1_000_000;

const COURT = { entree: 0.10, sortie: 0.50, ecritureCache: 0.125, relectureCache: 0.01 };
const LONG = { entree: 0.50, sortie: 2.50, ecritureCache: 0.625, relectureCache: 0.05 };

test('un prompt de 100 000 jetons d’entrée, pile au seuil, paie le tarif court', () => {
  expect(computeCost({ input_tokens: SEUIL }, MODELE).usd).toBeCloseTo(SEUIL * COURT.entree / MILLION, 12);
});

test('un prompt de 100 001 jetons d’entrée paie le tarif long sur tous ses jetons', () => {
  expect(computeCost({ input_tokens: SEUIL + 1 }, MODELE).usd).toBeCloseTo((SEUIL + 1) * LONG.entree / MILLION, 12);
});

test('au seuil, les jetons écrits en cache paient le tarif court', () => {
  expect(computeCost({ cache_creation_input_tokens: SEUIL }, MODELE).usd).toBeCloseTo(SEUIL * COURT.ecritureCache / MILLION, 12);
});

test('au-delà du seuil, les jetons écrits en cache paient le tarif long', () => {
  expect(computeCost({ cache_creation_input_tokens: SEUIL + 1 }, MODELE).usd)
    .toBeCloseTo((SEUIL + 1) * LONG.ecritureCache / MILLION, 12);
});

test('au seuil, les jetons relus du cache paient le tarif court', () => {
  expect(computeCost({ cache_read_input_tokens: SEUIL }, MODELE).usd).toBeCloseTo(SEUIL * COURT.relectureCache / MILLION, 12);
});

test('au-delà du seuil, les jetons relus du cache paient le tarif long', () => {
  expect(computeCost({ cache_read_input_tokens: SEUIL + 1 }, MODELE).usd)
    .toBeCloseTo((SEUIL + 1) * LONG.relectureCache / MILLION, 12);
});

test('la sortie d’un appel au prompt court paie le tarif court, quelle que soit sa taille', () => {
  // Arrange
  const usage = { input_tokens: SEUIL, output_tokens: MILLION };
  // Act
  const cout = computeCost(usage, MODELE);
  // Assert
  expect(cout.usd).toBeCloseTo(SEUIL * COURT.entree / MILLION + COURT.sortie, 12);
});

test('la sortie d’un appel au prompt long paie le tarif long', () => {
  // Arrange
  const usage = { input_tokens: SEUIL + 1, output_tokens: MILLION };
  // Act
  const cout = computeCost(usage, MODELE);
  // Assert
  expect(cout.usd).toBeCloseTo((SEUIL + 1) * LONG.entree / MILLION + LONG.sortie, 12);
});

test('le prompt se mesure entrée, écritures et relectures de cache réunies', () => {
  // Arrange
  const usage = { input_tokens: 1, cache_creation_input_tokens: 40_000, cache_read_input_tokens: 60_000 };
  // Act
  const cout = computeCost(usage, MODELE);
  // Assert
  expect(cout.usd).toBeCloseTo((1 * LONG.entree + 40_000 * LONG.ecritureCache + 60_000 * LONG.relectureCache) / MILLION, 12);
});

test('la sortie ne compte pas dans la longueur du prompt', () => {
  // Arrange
  const usage = { input_tokens: 1000, output_tokens: 200_000 };
  // Act
  const cout = computeCost(usage, MODELE);
  // Assert
  expect(cout.usd).toBeCloseTo((1000 * COURT.entree + 200_000 * COURT.sortie) / MILLION, 12);
});

test('au tarif long, le cache écrit pour une heure coûte deux fois l’entrée du tarif long', () => {
  // Arrange
  const usage = {
    cache_creation_input_tokens: MILLION,
    cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: MILLION },
  };
  // Act
  const cout = computeCost(usage, MODELE);
  // Assert
  expect(cout.usd).toBeCloseTo(LONG.entree * 2, 9);
});

test('un modèle sans tarif par longueur garde son prix au-delà de 100 000 jetons', () => {
  expect(computeCost({ input_tokens: MILLION }, 'claude-haiku-4-5').usd).toBeCloseTo(1, 9);
});

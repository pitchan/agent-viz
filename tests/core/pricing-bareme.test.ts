// Le barème que computeCost applique : tarifs de la famille Claude 5, tarif en vigueur
// à la date du message quand un modèle a changé de prix, et modèles à zéro voulu.
// Un modèle hors table reste inconnu — c'est le garde-fou que ces cas tiennent.
import { expect, test } from 'vitest';
import { computeCost } from '../../src/engine/core/pricing.ts';

const usage = {
  input_tokens: 1000,
  output_tokens: 2000,
  cache_creation_input_tokens: 10000,
  cache_read_input_tokens: 100000,
  cache_creation: { ephemeral_5m_input_tokens: 4000, ephemeral_1h_input_tokens: 6000 },
};

test('claude-fable-5 : 10 $/M entrée, 50 $/M sortie', () => {
  // 1000×1e-5 + 2000×5e-5 + 4000×1.25e-5 + 6000×(1e-5×2) + 100000×1e-6
  // = 0.01 + 0.1 + 0.05 + 0.12 + 0.1 = 0.38
  const r = computeCost(usage, 'claude-fable-5');
  expect(r.known).toBe(true);
  expect(r.usd).toBeCloseTo(0.38, 12);
});

test('claude-fable-5-1 : tarifs de fable-5, sauf la relecture de cache à 0,25 $/M', () => {
  // 1000×1e-5 + 2000×5e-5 + 4000×1.25e-5 + 6000×(1e-5×2) + 100000×2.5e-7
  // = 0.01 + 0.1 + 0.05 + 0.12 + 0.025 = 0.305
  const r = computeCost(usage, 'claude-fable-5-1');
  expect(r.known).toBe(true);
  expect(r.usd).toBeCloseTo(0.305, 12);
});

test('claude-mythos-5 : mêmes tarifs que fable-5', () => {
  const r = computeCost(usage, 'claude-mythos-5');
  expect(r.known).toBe(true);
  expect(r.usd).toBeCloseTo(0.38, 12);
});

test('claude-opus-5 : mêmes tarifs qu’opus-4-8 (5 $/M, 25 $/M)', () => {
  const r = computeCost(usage, 'claude-opus-5');
  expect(r.known).toBe(true);
  expect(r.usd).toBeCloseTo(0.19, 12);
});

test('claude-sonnet-5 après le 2026-09-01 : prix catalogue 3 $/M entrée, 15 $/M sortie', () => {
  // 0.003 + 0.03 + 4000×3.75e-6 + 6000×6e-6 + 0.03 = 0.114
  const r = computeCost(usage, 'claude-sonnet-5', '2026-09-01T00:00:00.000Z');
  expect(r.known).toBe(true);
  expect(r.usd).toBeCloseTo(0.114, 12);
});

test('contre-preuve carte observatoire : 1,2 M jetons cache 1h sur fable-5 = 24 $', () => {
  const r = computeCost(
    {
      cache_creation_input_tokens: 1_200_000,
      cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 1_200_000 },
    },
    'claude-fable-5',
  );
  expect(r.usd).toBeCloseTo(24.0, 9);
});

test('claude-sonnet-5 daté d’août 2026 : tarif de lancement 2 $/M entrée, 10 $/M sortie', () => {
  // 1000×2e-6 + 2000×1e-5 + 4000×2.5e-6 + 6000×(2e-6×2) + 100000×2e-7
  // = 0.002 + 0.02 + 0.01 + 0.024 + 0.02 = 0.076
  const r = computeCost(usage, 'claude-sonnet-5', '2026-08-15T12:00:00.000Z');
  expect(r.known).toBe(true);
  expect(r.usd).toBeCloseTo(0.076, 12);
});

test('la frontière est exclusive : dernier instant du 31/08 = lancement, minuit du 01/09 = catalogue', () => {
  const avant = computeCost(usage, 'claude-sonnet-5', '2026-08-31T23:59:59.999Z');
  const apres = computeCost(usage, 'claude-sonnet-5', '2026-09-01T00:00:00.000Z');
  expect(avant.usd).toBeCloseTo(0.076, 12);
  expect(apres.usd).toBeCloseTo(0.114, 12);
});

test('un modèle sans changement de tarif ignore la date (fable-5 identique à toute date)', () => {
  expect(computeCost(usage, 'claude-fable-5', '2026-08-15T12:00:00.000Z').usd).toBeCloseTo(0.38, 12);
  expect(computeCost(usage, 'claude-fable-5', '2027-01-01T00:00:00.000Z').usd).toBeCloseTo(0.38, 12);
});

test('sans date : tarif en vigueur maintenant (équivalent à at = new Date())', () => {
  const sans = computeCost(usage, 'claude-sonnet-5');
  const avec = computeCost(usage, 'claude-sonnet-5', new Date().toISOString());
  expect(sans.usd).toBe(avec.usd);
});

test('<synthetic> : 0 $ délibéré, prix CONNU', () => {
  expect(computeCost({ input_tokens: 10, output_tokens: 5 }, '<synthetic>')).toEqual({
    usd: 0,
    known: true,
    model: '<synthetic>',
  });
});

test('ministral-3:latest : modèle local Ollama, 0 $ API délibéré', () => {
  expect(computeCost({ input_tokens: 1000, output_tokens: 500 }, 'ministral-3:latest')).toEqual({
    usd: 0,
    known: true,
    model: 'ministral-3:latest',
  });
});

test('le garde-fou tient : un modèle hors liste reste inconnu (coût null)', () => {
  expect(computeCost({ input_tokens: 10 }, 'claude-futur-9')).toEqual({
    usd: null,
    known: false,
    model: 'claude-futur-9',
  });
});

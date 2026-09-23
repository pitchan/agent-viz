// computeCost : la formule elle-même, et ses gardes sur un `usage` que rien ne valide
// en amont — `normalizeEvent` écarte un `usage` non-objet, pas ses champs.
import { expect, test } from 'vitest';
import { computeCost } from '../../src/engine/core/pricing.ts';

test('avec split cache_creation : 1h à 2× input, 5m à cacheCreate', () => {
  const usage = {
    input_tokens: 1000,
    output_tokens: 2000,
    cache_creation_input_tokens: 10000,
    cache_read_input_tokens: 100000,
    cache_creation: { ephemeral_5m_input_tokens: 4000, ephemeral_1h_input_tokens: 6000 },
  };
  // 1000×5e-6 + 2000×2.5e-5 + 4000×6.25e-6 + 6000×(5e-6×2) + 100000×5e-7
  // = 0.005 + 0.05 + 0.025 + 0.06 + 0.05 = 0.19
  const r = computeCost(usage, 'claude-opus-4-8');
  expect(r.known).toBe(true);
  expect(r.model).toBe('claude-opus-4-8');
  expect(r.usd).toBeCloseTo(0.19, 12);
});

test('sans split : tout le cache_creation au tarif 5m', () => {
  const usage = {
    input_tokens: 1000,
    output_tokens: 2000,
    cache_creation_input_tokens: 10000,
    cache_read_input_tokens: 100000,
  };
  // 0.005 + 0.05 + 10000×6.25e-6 + 0.05 = 0.1675
  const r = computeCost(usage, 'claude-opus-4-8');
  expect(r.known).toBe(true);
  expect(r.usd).toBeCloseTo(0.1675, 12);
});

test('modèle inconnu → coût null, jamais un zéro silencieux', () => {
  expect(computeCost({ input_tokens: 10 }, 'claude-futur-9')).toEqual({
    usd: null,
    known: false,
    model: 'claude-futur-9',
  });
  expect(computeCost({ input_tokens: 10 }, null)).toEqual({ usd: null, known: false, model: null });
});

// Le serveur calcule son coût par `computeCost` lui aussi (src/server/tokens.ts).
// `cache_creation: null` est du JSON valide que rien n'arrête en amont : `normalizeEvent`
// écarte un `usage` non-objet, pas ses champs. Sans ces gardes, la fonction lèverait.
const attendu5m = (cc: number) => 100 * 5e-6 + cc * 6.25e-6; // opus-4-8

test('cache_creation null : pas de levée, tout le total au tarif 5m', () => {
  const r = computeCost(
    { input_tokens: 100, cache_creation_input_tokens: 50, cache_creation: null } as never,
    'claude-opus-4-8');
  expect(r.known).toBe(true);
  expect(r.usd).toBeCloseTo(attendu5m(50), 12);
});

test('cache_creation non-objet (0, chaîne) : traité comme absent', () => {
  for (const cc of [0, 'x', false]) {
    const r = computeCost(
      { input_tokens: 100, cache_creation_input_tokens: 50, cache_creation: cc } as never,
      'claude-opus-4-8');
    expect(r.usd).toBeCloseTo(attendu5m(50), 12);
  }
});

test('cache_creation objet vide : la ventilation est présente et vaut zéro', () => {
  // Contraste volontaire avec le cas ci-dessus : un objet VIDE dit « la
  // ventilation existe et vaut zéro », pas « pas de ventilation ».
  const r = computeCost(
    { input_tokens: 100, cache_creation_input_tokens: 50, cache_creation: {} },
    'claude-opus-4-8');
  expect(r.usd).toBeCloseTo(100 * 5e-6, 12);
});

test('usage absent : montant nul, modèle toujours reconnu', () => {
  for (const u of [null, undefined]) {
    const r = computeCost(u as never, 'claude-opus-4-8');
    expect(r.known).toBe(true);
    expect(r.usd).toBe(0);
  }
});

// computeCost garde chaque champ brut par `countOrZero` : un champ qui n'est
// pas un compte (NaN, Infinity, une chaîne, un négatif, un décimal) coûte zéro,
// comme il compte zéro jeton dans usage.ts — jamais une conversion implicite qui facture un texte.
const model = 'claude-opus-4-8';
const resteValide = {
  output_tokens: 2000,
  cache_creation_input_tokens: 10000,
  cache_read_input_tokens: 100000,
  cache_creation: { ephemeral_5m_input_tokens: 4000, ephemeral_1h_input_tokens: 6000 },
};
// Référence : mêmes champs valides, input_tokens à zéro — ce que doit rendre
// chaque cas malformé ci-dessous, puisque countOrZero les compte à zéro.
const coutSansInput = computeCost({ ...resteValide, input_tokens: 0 }, model).usd as number;

test.each([
  ['1e999, lu par JSON.parse comme Infinity', 1e999],
  ['NaN', NaN],
  ['chaîne non numérique', 'abc'],
  ['chaîne numérique convertible', '1000'],
  ['négatif', -10],
  ['décimal', 1.5],
])('input_tokens = %s : usd fini, champs valides facturés normalement', (_label, valeur) => {
  const r = computeCost({ ...resteValide, input_tokens: valeur } as never, model);
  expect(Number.isFinite(r.usd)).toBe(true);
  expect(r.usd).toBeCloseTo(coutSansInput, 12);
});

// Avec objet `cache_creation` présent : cache_creation_input_tokens n'est
// pas lu sur cette voie (la voie sans objet est prouvée plus bas).
test('les six champs bruts sont gardés, pas seulement input_tokens', () => {
  const r = computeCost(
    {
      input_tokens: 1e999,
      output_tokens: NaN,
      cache_creation_input_tokens: 'x',
      cache_read_input_tokens: 1e999,
      cache_creation: { ephemeral_5m_input_tokens: NaN, ephemeral_1h_input_tokens: 'y' },
    } as never,
    model,
  );
  expect(r.usd).toBe(0);
  expect(r.known).toBe(true);
});

// cache_creation_input_tokens n'est lu que quand l'objet cache_creation est
// absent (tout part alors au tarif 5m) : cette voie a sa propre garde à
// prouver, les cas ci-dessus ne l'atteignent jamais.
const reference = computeCost({ input_tokens: 10, output_tokens: 20 }, model).usd as number;

test.each([
  ['1e999', 1e999],
  ['NaN', NaN],
  ['chaîne non numérique', 'x'],
  ['chaîne numérique convertible', '1000'],
  ['négatif', -10],
  ['décimal', 1.5],
])('cache_creation_input_tokens = %s : usd fini, égal au coût des champs valides', (_label, valeur) => {
  const r = computeCost(
    { input_tokens: 10, output_tokens: 20, cache_creation_input_tokens: valeur } as never,
    model,
  );
  expect(Number.isFinite(r.usd)).toBe(true);
  expect(r.usd).toBeCloseTo(reference, 12);
});

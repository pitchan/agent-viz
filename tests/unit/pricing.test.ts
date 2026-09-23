// Pricing — id normalization, lookup, and per-message cost calculation.
// No network in these tests: the server's price map is built from the engine's
// embedded table when the module loads.

import { afterEach, expect, test, vi } from 'vitest';
import { getPrice } from '../../src/server/pricing.ts';
// `computeCost` et `normalizeModel` n'ont qu'une définition, celle du moteur :
// ces filets l'importent de src/engine/core/pricing.ts, et src/server/pricing.ts
// n'en porte pas de copie.
import { computeCost, normalizeModel, priceTable } from '../../src/engine/core/pricing.ts';
import { applyAdoptedPrices } from '../../src/server/pricing-state.ts';
import { HAUSSE_SONNET_5, pricingAvecHausse } from '../helpers/tariff-change.ts';

// Le barème du serveur est un état de module : chaque test repart de la table embarquée.
afterEach(() => applyAdoptedPrices({}));

test('normalizeModel strips provider prefixes and date/version suffixes', () => {
  expect(normalizeModel('claude-opus-4-7')).toBe('claude-opus-4-7');
  expect(normalizeModel('anthropic.claude-opus-4-7')).toBe('claude-opus-4-7');
  expect(normalizeModel('bedrock/claude-sonnet-4-5')).toBe('claude-sonnet-4-5');
  expect(normalizeModel('anthropic.claude-opus-4-7-v1:0')).toBe('claude-opus-4-7');
  expect(normalizeModel('claude-sonnet-4-5-20250929')).toBe('claude-sonnet-4-5');
  expect(normalizeModel('claude-opus-4-7@20251101')).toBe('claude-opus-4-7');
  expect(normalizeModel(null)).toBe(null);
  expect(normalizeModel('')).toBe(null);
});

test('normalizeModel strips regional routing prefixes and single-digit version suffixes', () => {
  // Cloud transcripts carry per-region routing ids (global./us./eu./au.anthropic.):
  // left un-normalized, a regional id reads as unpriced. The normalization lives in
  // the engine only.
  expect(normalizeModel('us.anthropic.claude-opus-4-7')).toBe('claude-opus-4-7');
  expect(normalizeModel('global.anthropic.claude-fable-5')).toBe('claude-fable-5');
  expect(normalizeModel('claude-opus-4-6-v1')).toBe('claude-opus-4-6');
});

test('getPrice resolves direct ids and provider-prefixed ids from the engine table', () => {
  const direct = getPrice('claude-sonnet-4-5')!;
  expect(direct, 'direct lookup should hit the engine table').toBeTruthy();
  expect(direct.label).toBe('Sonnet 4.5');

  const prefixed = getPrice('anthropic.claude-haiku-4-5-v1:0')!;
  expect(prefixed, 'prefixed lookup should normalize and hit').toBeTruthy();
  expect(prefixed.label).toBe('Haiku 4.5');
});

test('getPrice returns null for unknown models', () => {
  expect(getPrice('claude-sonnet-99-99')).toBe(null);
  expect(getPrice(null)).toBe(null);
  expect(getPrice(undefined)).toBe(null);
});

test('getPrice rend null pour un identifiant qui porte le nom d\'une propriété héritée', () => {
  // Arrange : l'identifiant de modèle vient d'un transcript écrit par un tiers.
  const noms = ['constructor', 'toString', '__proto__'];

  // Act
  const prix = noms.map(nom => getPrice(nom));

  // Assert
  expect(prix).toEqual([null, null, null]);
});

test('la carte du serveur rend, pour chaque modèle du barème du moteur, ses tarifs courants, son libellé, sa fenêtre de contexte et ses périodes datées', () => {
  // Arrange
  const table = priceTable();
  const apresToutePeriode = '2099-01-01T00:00:00.000Z';

  // Act
  const servis = table.entries.map(e => getPrice(e.model, apresToutePeriode));

  // Assert
  table.entries.forEach((e, i) => {
    const s = servis[i]!;
    expect(s, `${e.model} absent de la carte du serveur`).toBeTruthy();
    for (const f of ['input', 'output', 'cacheCreate', 'cacheRead'] as const) expect(s[f], `${e.model} ${f}`).toBe(e.current[f]);
    expect(s.label, `${e.model} label`).toBe(e.label);
    expect(s.maxInput, `${e.model} maxInput`).toBe(e.maxInput);
    expect(s.history, `${e.model} périodes datées`).toEqual(e.history);
  });
});

test('computeCost sums input/output/cache contributions', () => {
  // Sonnet 4.5: 3e-6 / 1.5e-5 / 3.75e-6 / 3e-7
  const cost = computeCost({
    input_tokens: 1_000,
    output_tokens: 500,
    cache_creation_input_tokens: 2_000,
    cache_read_input_tokens: 10_000,
  }, 'claude-sonnet-4-5');
  // 1000 * 3e-6 = 0.003
  // 500  * 1.5e-5 = 0.0075
  // 2000 * 3.75e-6 = 0.0075
  // 10000 * 3e-7 = 0.003
  // Total = 0.021
  // Le retour est un CONTRAT `{ usd, known, model }`, pas un nombre nu : il permet
  // de dire « ce montant est incomplet » au lieu de rendre un zéro qu'on ne sait pas
  // distinguer d'un vrai zéro.
  expect(cost.known).toBe(true);
  expect(Math.abs(cost.usd! - 0.021) < 1e-9, `got ${cost.usd}`).toBeTruthy();
});

test('computeCost charges the 1h cache tier at 2x input price (Anthropic rate card)', () => {
  // When the API reports cache_creation.ephemeral_1h_input_tokens the bytes
  // were written into the 1h cache, billed at 2x input — not 1.25x like the
  // 5min cache. Without this split, sessions that use the 1h cache (which
  // Claude Code does by default for system+tools prefix) are under-reported.
  //
  // Sonnet 4.5: input=3e-6, cacheCreate(5m)=3.75e-6 → 1h must be 6e-6.
  const cost = computeCost({
    input_tokens: 0, output_tokens: 0,
    cache_creation_input_tokens: 1000, // total = 5m+1h
    cache_read_input_tokens: 0,
    cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 1000 },
  }, 'claude-sonnet-4-5');
  // 1000 * 6e-6 = 0.006 (NOT 1000 * 3.75e-6 = 0.00375)
  expect(Math.abs(cost.usd! - 0.006) < 1e-9, `got ${cost.usd}, expected 0.006 (2x input rate)`).toBeTruthy();
});

test('computeCost without a cache_creation breakdown treats it all as 5min (back-compat)', () => {
  // Pre-1h-cache transcripts and providers that don't expose the split must
  // keep working — treat the total as 5min, matching legacy behavior.
  const cost = computeCost({
    input_tokens: 0, output_tokens: 0,
    cache_creation_input_tokens: 1000,
    cache_read_input_tokens: 0,
  }, 'claude-sonnet-4-5');
  // 1000 * 3.75e-6 = 0.00375
  expect(Math.abs(cost.usd! - 0.00375) < 1e-9, `got ${cost.usd}`).toBeTruthy();
});

test('computeCost splits mixed 5m+1h cache creations correctly', () => {
  const cost = computeCost({
    input_tokens: 0, output_tokens: 0,
    cache_creation_input_tokens: 1500,
    cache_read_input_tokens: 0,
    cache_creation: { ephemeral_5m_input_tokens: 500, ephemeral_1h_input_tokens: 1000 },
  }, 'claude-sonnet-4-5');
  // 500 * 3.75e-6 + 1000 * 6e-6 = 0.001875 + 0.006 = 0.007875
  expect(Math.abs(cost.usd! - 0.007875) < 1e-9, `got ${cost.usd}`).toBeTruthy();
});

// Un modèle sans tarif rend `{ usd: null, known: false }`, jamais `0` : le montant
// n'est pas inventé, et l'appelant SAIT que son total est incomplet, jusqu'à la
// pastille temps réel.
test('computeCost reports an unknown model as unpriced, never as a zero', () => {
  const cost = computeCost(
    { input_tokens: 1000, output_tokens: 500 },
    'claude-unknown-future-model',
  );
  expect(cost.usd, 'aucun montant inventé').toBe(null);
  expect(cost.known, 'et l’appelant peut le savoir').toBe(false);
  expect(cost.model).toBe('claude-unknown-future-model');
});

// `computeCost` prend un identifiant de modèle, jamais un objet de prix résolu :
// un objet contournerait la branche « modèle inconnu », et le total se lirait
// complet sans l'être.

test('the price map covers the Claude 5 family and Opus 4.8 (2026 rate card)', () => {
  // A missing entry made the observatory report ~$24 of 1h-cache rewrite on
  // Fable 5 as $0.02 — the server map must price the current family.
  const fable = getPrice('claude-fable-5')!;
  expect(fable, 'fable-5 must resolve from the engine table').toBeTruthy();
  expect(fable.input).toBe(1e-5);
  expect(fable.output).toBe(5e-5);
  expect(fable.cacheCreate).toBe(1.25e-5);
  expect(fable.cacheRead).toBe(1e-6);
  expect(fable.label).toBe('Fable 5');

  const mythos = getPrice('claude-mythos-5')!;
  expect(mythos, 'mythos-5 must resolve (same rates as fable-5)').toBeTruthy();
  expect(mythos.input).toBe(1e-5);

  const opus5 = getPrice('claude-opus-5')!;
  expect(opus5, 'opus-5 must resolve').toBeTruthy();
  expect(opus5.input).toBe(5e-6);
  expect(opus5.output).toBe(2.5e-5);
  expect(opus5.label).toBe('Opus 5');

  // Sonnet 5: the launch rate became the standard rate, the announced raise never happened.
  const sonnet5 = getPrice('claude-sonnet-5')!;
  expect(sonnet5, 'sonnet-5 must resolve').toBeTruthy();
  expect(sonnet5.input).toBe(2e-6);
  expect(sonnet5.output).toBe(1e-5);
  expect(sonnet5.label).toBe('Sonnet 5');

  const opus48 = getPrice('claude-opus-4-8')!;
  expect(opus48, 'opus-4-8 must resolve').toBeTruthy();
  expect(opus48.input).toBe(5e-6);
  expect(opus48.label).toBe('Opus 4.8');
});

test('computeCost prices 1.2M tokens of 1h cache on fable-5 at ~$24 (not $0.02)', () => {
  const cost = computeCost({
    input_tokens: 0, output_tokens: 0,
    cache_creation_input_tokens: 1_200_000,
    cache_read_input_tokens: 0,
    cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 1_200_000 },
  }, 'claude-fable-5');
  // 1_200_000 * (1e-5 * 2) = 24.0
  expect(Math.abs(cost.usd! - 24.0) < 1e-9, `got ${cost.usd}`).toBeTruthy();
});

test('normalizeModel strips the [1m] context-window suffix', () => {
  expect(normalizeModel('claude-fable-5[1m]')).toBe('claude-fable-5');
  expect(normalizeModel('claude-opus-4-8[1m]')).toBe('claude-opus-4-8');
});

test('getPrice resolves the tariff in effect at the given date (adopted sonnet-5 raise)', () => {
  // Tariffs change over time; the price map keeps a dated history so a message
  // is billed at the rate in effect when it was produced, not at scan time.
  applyAdoptedPrices(HAUSSE_SONNET_5);
  const aug = getPrice('claude-sonnet-5', '2026-08-15T00:00:00.000Z')!;
  expect(aug.input, 'before the raise = 2 $/M').toBe(2e-6);
  expect(aug.output).toBe(1e-5);
  expect(aug.cacheCreate).toBe(2.5e-6);
  expect(aug.cacheRead).toBe(2e-7);
  // Non-rate fields are inherited from the current entry.
  expect(aug.label).toBe('Sonnet 5');
  expect(aug.maxInput).toBe(1_000_000);

  const sept = getPrice('claude-sonnet-5', '2026-09-01T00:00:00.000Z')!;
  expect(sept.input, 'after the raise = 3 $/M').toBe(3e-6);
  expect(sept.output).toBe(1.5e-5);

  // A model with no tariff change ignores the date entirely.
  expect(getPrice('claude-fable-5', '2026-08-15T00:00:00.000Z')!.input).toBe(1e-5);
  expect(getPrice('claude-fable-5', '2027-01-01T00:00:00.000Z')!.input).toBe(1e-5);
});

test('getPrice without a date means "now" (same result as an explicit current timestamp)', () => {
  expect(getPrice('claude-sonnet-5')!.input).toBe(getPrice('claude-sonnet-5', new Date().toISOString())!.input);
});

test('computeCost with a model string honors the message date', () => {
  const usage = { input_tokens: 1000, output_tokens: 0 };
  const aug = pricingAvecHausse.computeCost(usage, 'claude-sonnet-5', '2026-08-15T00:00:00.000Z').usd!;
  const sept = pricingAvecHausse.computeCost(usage, 'claude-sonnet-5', '2026-09-15T00:00:00.000Z').usd!;
  expect(Math.abs(aug - 0.002) < 1e-12, `got ${aug} (rate before the raise expected)`).toBeTruthy();
  expect(Math.abs(sept - 0.003) < 1e-12, `got ${sept} (rate after the raise expected)`).toBeTruthy();
});

// Ce qui distingue un zéro VOULU d'un tarif inconnu est le champ `known` du
// contrat, qui voyage jusqu'à l'écran, et non une trace dans le journal du démon.
test('un zéro VOULU est connu, et ne rend pas le total incomplet', () => {
  for (const m of ['<synthetic>', 'ministral-3:latest']) {
    const r = computeCost({ input_tokens: 1000, output_tokens: 50 }, m);
    expect(r.usd, `${m} : zéro voulu`).toBe(0);
    expect(r.known, `${m} : et rangé COMME connu`).toBe(true);
  }
});

test('un modèle hors de la liste des zéros voulus est inconnu, sans rien journaliser', () => {
  const spy = vi.spyOn(console, 'error');
  const r = computeCost({ input_tokens: 10 }, 'mystery-model-9');
  expect(r.usd).toBe(null);
  expect(r.known).toBe(false);
  // TÉMOIN : aucune trace. L'information passe par le contrat, pas par le journal
  // du démon.
  expect(spy).toHaveBeenCalledTimes(0);
});


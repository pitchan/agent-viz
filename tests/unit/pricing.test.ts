// Pricing — id normalization, lookup, and per-message cost calculation.
// No network in these tests: the server's price map is built from the engine's
// embedded table when the module loads.

import { expect, test, vi } from 'vitest';
import { getPrice, _internals } from '../../src/server/pricing.ts';
// `computeCost` et `normalizeModel` n'ont qu'une définition, celle du moteur :
// ces filets l'importent de src/engine/core/pricing.ts, et src/server/pricing.ts
// n'en porte pas de copie.
import { computeCost, normalizeModel, priceTable } from '../../src/engine/core/pricing.ts';

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
  // LiteLLM carries per-region routing ids (global./us./eu./au.anthropic.): left
  // un-normalized, each raises a false "modele-nouveau" alert, and a regional id
  // reads as unpriced. The normalization lives in the engine only.
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

test('litellmDrift rejects __proto__ / constructor / prototype keys and never pollutes', () => {
  const Object_proto_before = Object.prototype.toString;
  const malicious = {
    'claude-opus-4-7': {
      input_cost_per_token: 5e-6, output_cost_per_token: 2.5e-5,
      cache_creation_input_token_cost: 6.25e-6, cache_read_input_token_cost: 5e-7,
      max_input_tokens: 1_000_000,
    },
    'claude-opus-4-7.__proto__': { input_cost_per_token: 1, output_cost_per_token: 1 },
  };
  const drifts = _internals.litellmDrift(malicious, '2026-08-15T00:00:00.000Z');
  expect(Object.prototype.toString).toBe(Object_proto_before);
  expect(({} as Record<string, unknown>).polluted).toBe(undefined);
  // The legit, identical entry produces no drift; the malicious key is skipped.
  expect(drifts).toEqual([]);
});

test('FORBIDDEN_KEYS contains the dangerous property names', () => {
  expect(_internals.FORBIDDEN_KEYS.has('__proto__')).toBeTruthy();
  expect(_internals.FORBIDDEN_KEYS.has('constructor')).toBeTruthy();
  expect(_internals.FORBIDDEN_KEYS.has('prototype')).toBeTruthy();
});

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

  // Sonnet 5 current (sticker) rates — an explicit post-2026-09-01 date pins
  // the assertion; the intro period is covered by the dated-tariff tests.
  const sonnet5 = getPrice('claude-sonnet-5', '2026-09-01T00:00:00.000Z')!;
  expect(sonnet5, 'sonnet-5 must resolve').toBeTruthy();
  expect(sonnet5.input).toBe(3e-6);
  expect(sonnet5.output).toBe(1.5e-5);
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

test('getPrice resolves the tariff in effect at the given date (sonnet-5 intro until 2026-08-31)', () => {
  // Tariffs change over time; the price map keeps a dated history so a message
  // is billed at the rate in effect when it was produced, not at scan time.
  const aug = getPrice('claude-sonnet-5', '2026-08-15T00:00:00.000Z')!;
  expect(aug.input, 'August = intro rate 2 $/M').toBe(2e-6);
  expect(aug.output).toBe(1e-5);
  expect(aug.cacheCreate).toBe(2.5e-6);
  expect(aug.cacheRead).toBe(2e-7);
  // Non-rate fields are inherited from the current entry.
  expect(aug.label).toBe('Sonnet 5');
  expect(aug.maxInput).toBe(1_000_000);

  const sept = getPrice('claude-sonnet-5', '2026-09-01T00:00:00.000Z')!;
  expect(sept.input, 'from 2026-09-01 = sticker rate 3 $/M').toBe(3e-6);
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
  const aug = computeCost(usage, 'claude-sonnet-5', '2026-08-15T00:00:00.000Z').usd!;
  const sept = computeCost(usage, 'claude-sonnet-5', '2026-09-15T00:00:00.000Z').usd!;
  expect(Math.abs(aug - 0.002) < 1e-12, `got ${aug} (intro rate expected)`).toBeTruthy();
  expect(Math.abs(sept - 0.003) < 1e-12, `got ${sept} (sticker rate expected)`).toBeTruthy();
});

test('a changed upstream tariff is REPORTED as drift, never applied to the map', () => {
  const entry = {
    output_cost_per_token: 6e-5, cache_creation_input_token_cost: 2.5e-5,
    cache_read_input_token_cost: 2e-6, max_input_tokens: 1_000_000,
  };
  const drifts = _internals.litellmDrift({
    'claude-fable-5': { ...entry, input_cost_per_token: 2e-5 },
  }, '2026-08-15T00:00:00.000Z');
  expect(drifts.length).toBe(1);
  expect(drifts[0]!.model).toBe('claude-fable-5');
  expect(drifts[0]!.kind).toBe('tarif-different');
  expect(drifts[0]!.litellm.input).toBe(2e-5);
  expect(drifts[0]!.embedded!.input).toBe(1e-5);
  // The price map is untouched: the embedded table still bills fable at 1e-5.
  expect(getPrice('claude-fable-5')!.input).toBe(1e-5);
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

test('an identical LiteLLM feed produces zero drift', () => {
  const feed = {
    'claude-opus-4-8': {
      input_cost_per_token: 5e-6, output_cost_per_token: 2.5e-5,
      cache_creation_input_token_cost: 6.25e-6, cache_read_input_token_cost: 5e-7,
      max_input_tokens: 1_000_000,
    },
  };
  expect(_internals.litellmDrift(feed, '2026-08-15T00:00:00.000Z')).toEqual([]);
});

test('a new canonical Claude model absent from the embedded table is reported', () => {
  const feed = {
    'claude-opus-6': {
      input_cost_per_token: 7e-6, output_cost_per_token: 3.5e-5,
      cache_creation_input_token_cost: 8.75e-6, cache_read_input_token_cost: 7e-7,
      max_input_tokens: 1_000_000,
    },
  };
  const drifts = _internals.litellmDrift(feed, '2026-08-15T00:00:00.000Z');
  expect(drifts.length).toBe(1);
  expect(drifts[0]!.model).toBe('claude-opus-6');
  expect(drifts[0]!.kind).toBe('modele-nouveau');
  expect(drifts[0]!.embedded).toBe(null);
});

test('sonnet-5 at the intro rate is NOT a drift during the launch window, IS one after', () => {
  // LiteLLM stores the intro rate as "current": during the launch window the billing
  // is the same, only the representation differs. From 2026-09-01 the embedded table
  // switches to the sticker rate, and a stale feed becomes a drift.
  const feed = {
    'claude-sonnet-5': {
      input_cost_per_token: 2e-6, output_cost_per_token: 1e-5,
      cache_creation_input_token_cost: 2.5e-6, cache_read_input_token_cost: 2e-7,
      max_input_tokens: 1_000_000,
    },
  };
  expect(_internals.litellmDrift(feed, '2026-08-15T00:00:00.000Z')).toEqual([]);
  const after = _internals.litellmDrift(feed, '2026-09-02T00:00:00.000Z');
  expect(after.length).toBe(1);
  expect(after[0]!.kind).toBe('tarif-different');
});

test('a vigil pass never touches the price map: the dated period survives', () => {
  // Anti-regression lock: no code path writes the price map from LiteLLM. A sticker
  // feed for sonnet-5 is a drift by construction during the launch window, and the
  // dated intro period (valid until 2026-09-01) still comes out of getPrice after it.
  const feed = {
    'claude-sonnet-5': {
      input_cost_per_token: 3e-6, output_cost_per_token: 1.5e-5,
      cache_creation_input_token_cost: 3.75e-6, cache_read_input_token_cost: 3e-7,
      max_input_tokens: 1_000_000,
    },
  };
  const drifts = _internals.litellmDrift(feed, '2026-08-15T00:00:00.000Z');
  expect(getPrice('claude-sonnet-5', '2026-08-15T00:00:00.000Z')!.input).toBe(2e-6);
  expect(drifts.length).toBe(1);
  expect(drifts[0]!.model).toBe('claude-sonnet-5');
  expect(drifts[0]!.kind).toBe('tarif-different');
});

test('historical models and regional variants never alert', () => {
  // "Absent from the table" alone is not "new" —
  // historical ids (claude-opus-4-1) and un-normalized regional routing
  // variants (us./global.anthropic.) are also absent, but are not news.
  const at = '2026-08-15T00:00:00.000Z';
  const feed = {
    'us.anthropic.claude-opus-4-7': {
      input_cost_per_token: 5e-6, output_cost_per_token: 2.5e-5,
      cache_creation_input_token_cost: 6.25e-6, cache_read_input_token_cost: 5e-7,
      max_input_tokens: 1_000_000,
    },
    'claude-opus-4-1': {
      input_cost_per_token: 4e-6, output_cost_per_token: 2e-5,
      cache_creation_input_token_cost: 5e-6, cache_read_input_token_cost: 4e-7,
      max_input_tokens: 200_000,
    },
    'global.anthropic.claude-fable-5': {
      input_cost_per_token: 1e-5, output_cost_per_token: 5e-5,
      cache_creation_input_token_cost: 1.25e-5, cache_read_input_token_cost: 1e-6,
      max_input_tokens: 1_000_000,
    },
  };
  expect(_internals.litellmDrift(feed, at)).toEqual([]);
});

test('a version above the family max alerts as modele-nouveau', () => {
  const feed = {
    'claude-haiku-5': {
      input_cost_per_token: 1e-6, output_cost_per_token: 5e-6,
      cache_creation_input_token_cost: 1.25e-6, cache_read_input_token_cost: 1e-7,
      max_input_tokens: 1_000_000,
    },
  };
  const drifts = _internals.litellmDrift(feed, '2026-08-15T00:00:00.000Z');
  expect(drifts.length).toBe(1);
  expect(drifts[0]!.model).toBe('claude-haiku-5');
  expect(drifts[0]!.kind).toBe('modele-nouveau');
});

test('regional premium endpoints are different SKUs, not tariff drift', () => {
  // On the real feed, us./eu./au.anthropic.* carry a uniform +10% premium over the
  // base (direct-API) tariff the embedded table represents: a different SKU, not a
  // drift of the canonical model — the bare key is the only one compared.
  const base = {
    input_cost_per_token: 5e-6, output_cost_per_token: 2.5e-5,
    cache_creation_input_token_cost: 6.25e-6, cache_read_input_token_cost: 5e-7,
    max_input_tokens: 1_000_000,
  };
  const premium = {
    input_cost_per_token: 5.5e-6, output_cost_per_token: 2.75e-5,
    cache_creation_input_token_cost: 6.875e-6, cache_read_input_token_cost: 5.5e-7,
    max_input_tokens: 1_000_000,
  };
  const feed = {
    'claude-opus-4-7': base,
    'us.anthropic.claude-opus-4-7': premium,
    'eu.anthropic.claude-opus-4-7': premium,
    'au.anthropic.claude-opus-4-7': premium,
  };
  expect(_internals.litellmDrift(feed, '2026-08-15T00:00:00.000Z')).toEqual([]);
});

test('a base-rate change on the bare key still reports drift', () => {
  const feed = {
    'claude-opus-4-7': {
      input_cost_per_token: 9e-6, output_cost_per_token: 2.5e-5,
      cache_creation_input_token_cost: 6.25e-6, cache_read_input_token_cost: 5e-7,
      max_input_tokens: 1_000_000,
    },
  };
  const drifts = _internals.litellmDrift(feed, '2026-08-15T00:00:00.000Z');
  expect(drifts.length).toBe(1);
  expect(drifts[0]!.model).toBe('claude-opus-4-7');
  expect(drifts[0]!.kind).toBe('tarif-different');
});

test('a new model under several regional variants alerts exactly once', () => {
  const entry = {
    input_cost_per_token: 1e-6, output_cost_per_token: 5e-6,
    cache_creation_input_token_cost: 1.25e-6, cache_read_input_token_cost: 1e-7,
    max_input_tokens: 1_000_000,
  };
  const feed = {
    'claude-haiku-5': entry,
    'us.anthropic.claude-haiku-5': entry,
    'eu.anthropic.claude-haiku-5': entry,
  };
  const drifts = _internals.litellmDrift(feed, '2026-08-15T00:00:00.000Z');
  expect(drifts.length).toBe(1);
  expect(drifts[0]!.model).toBe('claude-haiku-5');
  expect(drifts[0]!.kind).toBe('modele-nouveau');
});

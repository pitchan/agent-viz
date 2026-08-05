'use strict';
// Pricing — id normalization, lookup, and per-message cost calculation.
// No network in these tests: we exercise the static FALLBACK plus the test
// hook (_setPricesForTest).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  getPrice, computeCost, normalizeId, _FALLBACK, _setPricesForTest,
} = require('../../lib/server/pricing');

test('normalizeId strips provider prefixes and date/version suffixes', () => {
  assert.equal(normalizeId('claude-opus-4-7'), 'claude-opus-4-7');
  assert.equal(normalizeId('anthropic.claude-opus-4-7'), 'claude-opus-4-7');
  assert.equal(normalizeId('bedrock/claude-sonnet-4-5'), 'claude-sonnet-4-5');
  assert.equal(normalizeId('anthropic.claude-opus-4-7-v1:0'), 'claude-opus-4-7');
  assert.equal(normalizeId('claude-sonnet-4-5-20250929'), 'claude-sonnet-4-5');
  assert.equal(normalizeId('claude-opus-4-7@20251101'), 'claude-opus-4-7');
  assert.equal(normalizeId(null), null);
  assert.equal(normalizeId(''), null);
});

test('normalizeId strips regional routing prefixes and single-digit version suffixes', () => {
  // Root cause of most of the 109 false "modele-nouveau" alerts: LiteLLM
  // carries per-region routing ids (global./us./eu./au.anthropic.) that
  // never normalized down to the canonical id.
  assert.equal(normalizeId('us.anthropic.claude-opus-4-7'), 'claude-opus-4-7');
  assert.equal(normalizeId('global.anthropic.claude-fable-5'), 'claude-fable-5');
  assert.equal(normalizeId('claude-opus-4-6-v1'), 'claude-opus-4-6');
});

test('getPrice resolves direct ids and provider-prefixed ids from the fallback map', () => {
  const direct = getPrice('claude-sonnet-4-5');
  assert.ok(direct, 'direct lookup should hit fallback');
  assert.equal(direct, _FALLBACK['claude-sonnet-4-5']);

  const prefixed = getPrice('anthropic.claude-haiku-4-5-v1:0');
  assert.ok(prefixed, 'prefixed lookup should normalize and hit');
  assert.equal(prefixed.label, 'Haiku 4.5');
});

test('getPrice returns null for unknown models', () => {
  assert.equal(getPrice('claude-sonnet-99-99'), null);
  assert.equal(getPrice(null), null);
  assert.equal(getPrice(undefined), null);
});

test('computeCost sums input/output/cache contributions', () => {
  // Sonnet 4.5 fallback: 3e-6 / 1.5e-5 / 3.75e-6 / 3e-7
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
  assert.ok(Math.abs(cost - 0.021) < 1e-9, `got ${cost}`);
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
  assert.ok(Math.abs(cost - 0.006) < 1e-9, `got ${cost}, expected 0.006 (2x input rate)`);
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
  assert.ok(Math.abs(cost - 0.00375) < 1e-9, `got ${cost}`);
});

test('computeCost splits mixed 5m+1h cache creations correctly', () => {
  const cost = computeCost({
    input_tokens: 0, output_tokens: 0,
    cache_creation_input_tokens: 1500,
    cache_read_input_tokens: 0,
    cache_creation: { ephemeral_5m_input_tokens: 500, ephemeral_1h_input_tokens: 1000 },
  }, 'claude-sonnet-4-5');
  // 500 * 3.75e-6 + 1000 * 6e-6 = 0.001875 + 0.006 = 0.007875
  assert.ok(Math.abs(cost - 0.007875) < 1e-9, `got ${cost}`);
});

test('computeCost returns 0 for unknown model rather than NaN/throw', () => {
  const cost = computeCost(
    { input_tokens: 1000, output_tokens: 500 },
    'claude-unknown-future-model',
  );
  assert.equal(cost, 0);
});

test('computeCost accepts a resolved price object directly (avoids double lookup)', () => {
  // Hot-path: tokens.js resolves the price once and reuses it. Verify the
  // dual signature works without going through getPrice() a second time.
  const price = getPrice('claude-sonnet-4-5');
  const cost = computeCost({ input_tokens: 1000, output_tokens: 500 }, price);
  // 1000*3e-6 + 500*1.5e-5 = 0.003 + 0.0075 = 0.0105
  assert.ok(Math.abs(cost - 0.0105) < 1e-9, `got ${cost}`);
});

test('litellmDrift rejects __proto__ / constructor / prototype keys and never pollutes', () => {
  const { _internals } = require('../../lib/server/pricing');
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
  assert.strictEqual(Object.prototype.toString, Object_proto_before);
  assert.equal({}.polluted, undefined);
  // The legit, identical entry produces no drift; the malicious key is skipped.
  assert.deepEqual(drifts, []);
});

test('FORBIDDEN_KEYS contains the dangerous property names', () => {
  const { _internals } = require('../../lib/server/pricing');
  assert.ok(_internals.FORBIDDEN_KEYS.has('__proto__'));
  assert.ok(_internals.FORBIDDEN_KEYS.has('constructor'));
  assert.ok(_internals.FORBIDDEN_KEYS.has('prototype'));
});

test('_setPricesForTest overrides without mutating the FALLBACK constant', () => {
  _setPricesForTest({
    'fake-model': { input: 1, output: 2, cacheCreate: 0, cacheRead: 0, maxInput: 1000, label: 'Fake' },
  });
  const p = getPrice('fake-model');
  assert.equal(p.input, 1);
  assert.equal(p.label, 'Fake');
  // Restore to fallback so later tests in the same process aren't polluted.
  _setPricesForTest({});
});

test('FALLBACK covers the Claude 5 family and Opus 4.8 (2026 rate card)', () => {
  // A missing entry made the observatory report ~$24 of 1h-cache rewrite on
  // Fable 5 as $0.02 — the fallback must price the current family offline.
  const fable = getPrice('claude-fable-5');
  assert.ok(fable, 'fable-5 must resolve from the static fallback');
  assert.equal(fable.input, 1e-5);
  assert.equal(fable.output, 5e-5);
  assert.equal(fable.cacheCreate, 1.25e-5);
  assert.equal(fable.cacheRead, 1e-6);
  assert.equal(fable.label, 'Fable 5');

  const mythos = getPrice('claude-mythos-5');
  assert.ok(mythos, 'mythos-5 must resolve (same rates as fable-5)');
  assert.equal(mythos.input, 1e-5);

  const opus5 = getPrice('claude-opus-5');
  assert.ok(opus5, 'opus-5 must resolve');
  assert.equal(opus5.input, 5e-6);
  assert.equal(opus5.output, 2.5e-5);
  assert.equal(opus5.label, 'Opus 5');

  // Sonnet 5 current (sticker) rates — an explicit post-2026-09-01 date pins
  // the assertion; the intro period is covered by the dated-tariff tests.
  const sonnet5 = getPrice('claude-sonnet-5', '2026-09-01T00:00:00.000Z');
  assert.ok(sonnet5, 'sonnet-5 must resolve');
  assert.equal(sonnet5.input, 3e-6);
  assert.equal(sonnet5.output, 1.5e-5);
  assert.equal(sonnet5.label, 'Sonnet 5');

  const opus48 = getPrice('claude-opus-4-8');
  assert.ok(opus48, 'opus-4-8 must resolve (was missing from the fallback)');
  assert.equal(opus48.input, 5e-6);
  assert.equal(opus48.label, 'Opus 4.8');
});

test('computeCost prices 1.2M tokens of 1h cache on fable-5 at ~$24 (not $0.02)', () => {
  const cost = computeCost({
    input_tokens: 0, output_tokens: 0,
    cache_creation_input_tokens: 1_200_000,
    cache_read_input_tokens: 0,
    cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 1_200_000 },
  }, 'claude-fable-5');
  // 1_200_000 * (1e-5 * 2) = 24.0
  assert.ok(Math.abs(cost - 24.0) < 1e-9, `got ${cost}`);
});

test('normalizeId strips the [1m] context-window suffix (netgain mirror)', () => {
  assert.equal(normalizeId('claude-fable-5[1m]'), 'claude-fable-5');
  assert.equal(normalizeId('claude-opus-4-8[1m]'), 'claude-opus-4-8');
});

test('getPrice resolves the tariff in effect at the given date (sonnet-5 intro until 2026-08-31)', () => {
  // Tariffs change over time; the price map keeps a dated history so a message
  // is billed at the rate in effect when it was produced, not at scan time.
  const aug = getPrice('claude-sonnet-5', '2026-08-15T00:00:00.000Z');
  assert.equal(aug.input, 2e-6, 'August = intro rate 2 $/M');
  assert.equal(aug.output, 1e-5);
  assert.equal(aug.cacheCreate, 2.5e-6);
  assert.equal(aug.cacheRead, 2e-7);
  // Non-rate fields are inherited from the current entry.
  assert.equal(aug.label, 'Sonnet 5');
  assert.equal(aug.maxInput, 1_000_000);

  const sept = getPrice('claude-sonnet-5', '2026-09-01T00:00:00.000Z');
  assert.equal(sept.input, 3e-6, 'from 2026-09-01 = sticker rate 3 $/M');
  assert.equal(sept.output, 1.5e-5);

  // A model with no tariff change ignores the date entirely.
  assert.equal(getPrice('claude-fable-5', '2026-08-15T00:00:00.000Z').input, 1e-5);
  assert.equal(getPrice('claude-fable-5', '2027-01-01T00:00:00.000Z').input, 1e-5);
});

test('getPrice without a date means "now" (same result as an explicit current timestamp)', () => {
  assert.equal(
    getPrice('claude-sonnet-5').input,
    getPrice('claude-sonnet-5', new Date().toISOString()).input,
  );
});

test('computeCost with a model string honors the message date', () => {
  const usage = { input_tokens: 1000, output_tokens: 0 };
  const aug = computeCost(usage, 'claude-sonnet-5', '2026-08-15T00:00:00.000Z');
  const sept = computeCost(usage, 'claude-sonnet-5', '2026-09-15T00:00:00.000Z');
  assert.ok(Math.abs(aug - 0.002) < 1e-12, `got ${aug} (intro rate expected)`);
  assert.ok(Math.abs(sept - 0.003) < 1e-12, `got ${sept} (sticker rate expected)`);
});

test('a changed upstream tariff is REPORTED as drift, never applied to the map', () => {
  const { _internals } = require('../../lib/server/pricing');
  const entry = {
    output_cost_per_token: 6e-5, cache_creation_input_token_cost: 2.5e-5,
    cache_read_input_token_cost: 2e-6, max_input_tokens: 1_000_000,
  };
  const drifts = _internals.litellmDrift({
    'claude-fable-5': { ...entry, input_cost_per_token: 2e-5 },
  }, '2026-08-15T00:00:00.000Z');
  assert.equal(drifts.length, 1);
  assert.equal(drifts[0].model, 'claude-fable-5');
  assert.equal(drifts[0].kind, 'tarif-different');
  assert.equal(drifts[0].litellm.input, 2e-5);
  assert.equal(drifts[0].embedded.input, 1e-5);
  // The price map is untouched: the embedded table still bills fable at 1e-5.
  assert.equal(getPrice('claude-fable-5').input, 1e-5);
});

test('deliberate zero-cost models cost 0 without the unknown-model warning', t => {
  const spy = t.mock.method(console, 'error');
  assert.equal(computeCost({ input_tokens: 1000, output_tokens: 50 }, '<synthetic>'), 0);
  assert.equal(computeCost({ input_tokens: 1000, output_tokens: 50 }, 'ministral-3:latest'), 0);
  assert.equal(spy.mock.callCount(), 0);
});

test('a model outside the zero-cost list still warns once and reports 0', t => {
  const spy = t.mock.method(console, 'error');
  assert.equal(computeCost({ input_tokens: 10 }, 'mystery-model-9'), 0);
  assert.equal(spy.mock.callCount(), 1);
});

test('an identical LiteLLM feed produces zero drift', () => {
  const { _internals } = require('../../lib/server/pricing');
  const feed = {
    'claude-opus-4-8': {
      input_cost_per_token: 5e-6, output_cost_per_token: 2.5e-5,
      cache_creation_input_token_cost: 6.25e-6, cache_read_input_token_cost: 5e-7,
      max_input_tokens: 1_000_000,
    },
  };
  assert.deepEqual(_internals.litellmDrift(feed, '2026-08-15T00:00:00.000Z'), []);
});

test('a new canonical Claude model absent from the embedded table is reported', () => {
  const { _internals } = require('../../lib/server/pricing');
  const feed = {
    'claude-opus-6': {
      input_cost_per_token: 7e-6, output_cost_per_token: 3.5e-5,
      cache_creation_input_token_cost: 8.75e-6, cache_read_input_token_cost: 7e-7,
      max_input_tokens: 1_000_000,
    },
  };
  const drifts = _internals.litellmDrift(feed, '2026-08-15T00:00:00.000Z');
  assert.equal(drifts.length, 1);
  assert.equal(drifts[0].model, 'claude-opus-6');
  assert.equal(drifts[0].kind, 'modele-nouveau');
  assert.equal(drifts[0].embedded, null);
});

test('sonnet-5 at the intro rate is NOT a drift during the launch window, IS one after', () => {
  // The 2026-08-05 measurement: LiteLLM stores the intro rate as "current" —
  // same billing today, a representation difference. After 2026-09-01 the
  // embedded table switches to the sticker rate; a stale feed becomes a drift.
  const { _internals } = require('../../lib/server/pricing');
  const feed = {
    'claude-sonnet-5': {
      input_cost_per_token: 2e-6, output_cost_per_token: 1e-5,
      cache_creation_input_token_cost: 2.5e-6, cache_read_input_token_cost: 2e-7,
      max_input_tokens: 1_000_000,
    },
  };
  assert.deepEqual(_internals.litellmDrift(feed, '2026-08-15T00:00:00.000Z'), []);
  const after = _internals.litellmDrift(feed, '2026-09-02T00:00:00.000Z');
  assert.equal(after.length, 1);
  assert.equal(after[0].kind, 'tarif-different');
});

test('a vigil pass never touches the price map: the dated period survives', () => {
  // Anti-regression lock for the T11 Critical: no code path may write the
  // price map from LiteLLM anymore. Feed the CATALOG (sticker) rate for
  // sonnet-5 — during the launch window the embedded table's CURRENT tariff
  // is the intro rate, so the sticker feed is a drift by construction — and
  // confirm the dated period (intro rate, valid until 2026-09-01) is still
  // exactly what getPrice returns afterwards.
  const { _internals } = require('../../lib/server/pricing');
  const feed = {
    'claude-sonnet-5': {
      input_cost_per_token: 3e-6, output_cost_per_token: 1.5e-5,
      cache_creation_input_token_cost: 3.75e-6, cache_read_input_token_cost: 3e-7,
      max_input_tokens: 1_000_000,
    },
  };
  const drifts = _internals.litellmDrift(feed, '2026-08-15T00:00:00.000Z');
  assert.equal(getPrice('claude-sonnet-5', '2026-08-15T00:00:00.000Z').input, 2e-6);
  assert.equal(drifts.length, 1);
  assert.equal(drifts[0].model, 'claude-sonnet-5');
  assert.equal(drifts[0].kind, 'tarif-different');
});

test('historical models and regional variants never alert', () => {
  // Decision Vincent 2026-08-05: "absent from the table" alone is not "new" —
  // historical ids (claude-opus-4-1) and un-normalized regional routing
  // variants (us./global.anthropic.) are also absent, but are not news.
  const { _internals } = require('../../lib/server/pricing');
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
  assert.deepEqual(_internals.litellmDrift(feed, at), []);
});

test('a version above the family max alerts as modele-nouveau', () => {
  const { _internals } = require('../../lib/server/pricing');
  const feed = {
    'claude-haiku-5': {
      input_cost_per_token: 1e-6, output_cost_per_token: 5e-6,
      cache_creation_input_token_cost: 1.25e-6, cache_read_input_token_cost: 1e-7,
      max_input_tokens: 1_000_000,
    },
  };
  const drifts = _internals.litellmDrift(feed, '2026-08-15T00:00:00.000Z');
  assert.equal(drifts.length, 1);
  assert.equal(drifts[0].model, 'claude-haiku-5');
  assert.equal(drifts[0].kind, 'modele-nouveau');
});

test('regional premium endpoints are different SKUs, not tariff drift', () => {
  // Measured on the real feed 2026-08-05: us./eu./au.anthropic.* carry a
  // uniform +10% premium over the base (direct-API) tariff the embedded
  // table represents. That premium is a legitimate different SKU, not a
  // drift of the canonical model — the bare key is the only one compared.
  const { _internals } = require('../../lib/server/pricing');
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
  assert.deepEqual(_internals.litellmDrift(feed, '2026-08-15T00:00:00.000Z'), []);
});

test('a base-rate change on the bare key still reports drift', () => {
  const { _internals } = require('../../lib/server/pricing');
  const feed = {
    'claude-opus-4-7': {
      input_cost_per_token: 9e-6, output_cost_per_token: 2.5e-5,
      cache_creation_input_token_cost: 6.25e-6, cache_read_input_token_cost: 5e-7,
      max_input_tokens: 1_000_000,
    },
  };
  const drifts = _internals.litellmDrift(feed, '2026-08-15T00:00:00.000Z');
  assert.equal(drifts.length, 1);
  assert.equal(drifts[0].model, 'claude-opus-4-7');
  assert.equal(drifts[0].kind, 'tarif-different');
});

test('a new model under several regional variants alerts exactly once', () => {
  const { _internals } = require('../../lib/server/pricing');
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
  assert.equal(drifts.length, 1);
  assert.equal(drifts[0].model, 'claude-haiku-5');
  assert.equal(drifts[0].kind, 'modele-nouveau');
});

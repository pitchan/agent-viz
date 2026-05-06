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

test('ingestLitellm rejects __proto__ / constructor / prototype keys', () => {
  // Defence in depth — even if a malicious mirror sneaks past the regex
  // filter, the FORBIDDEN_KEYS gate must not let prototype-mutating keys
  // through into the price map.
  const { _internals } = require('../../lib/server/pricing');
  const Object_proto_before = Object.prototype.toString;
  const malicious = {
    'claude-opus-4-7': {
      input_cost_per_token: 5e-6, output_cost_per_token: 2.5e-5,
      cache_creation_input_token_cost: 6.25e-6, cache_read_input_token_cost: 5e-7,
      max_input_tokens: 1_000_000,
    },
    // Crafted to slip past the regex filter via the (\.|/) alternation if
    // we relaxed the canonical-id check. Even if it gets in, we must reject.
    'claude-opus-4-7.__proto__': { input_cost_per_token: 1, output_cost_per_token: 1 },
  };
  _internals.ingestLitellm(malicious);
  // Assert no prototype mutation occurred.
  assert.strictEqual(Object.prototype.toString, Object_proto_before);
  assert.equal({}.polluted, undefined);
  // Sanity: the legit entry is still loaded.
  assert.ok(getPrice('claude-opus-4-7'));
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

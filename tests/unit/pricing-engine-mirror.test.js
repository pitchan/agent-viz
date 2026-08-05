'use strict';
// UNIFICATION (2026-08-05): one price table for the whole product. The static
// FALLBACK is the offline mirror of the engine's embedded table — this file
// turns the "they are identical" guarantee from a manual check into a test
// that breaks. Requires the npm-linked engine, like the contract test.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { _FALLBACK, applyEnginePrices, computeCost, _setPricesForTest } = require('../../lib/server/pricing');
const { loadEngine } = require('../../lib/server/observatory/engine');

test('FALLBACK mirrors the engine table: rates, labels, context windows, dated periods', async () => {
  const { priceTable } = await loadEngine();
  const table = priceTable();
  assert.equal(Object.keys(_FALLBACK).length, table.entries.length);
  for (const e of table.entries) {
    const f = _FALLBACK[e.model];
    assert.ok(f, `${e.model} missing from FALLBACK`);
    assert.equal(f.input, e.current.input, `${e.model} input`);
    assert.equal(f.output, e.current.output, `${e.model} output`);
    assert.equal(f.cacheCreate, e.current.cacheCreate, `${e.model} cacheCreate`);
    assert.equal(f.cacheRead, e.current.cacheRead, `${e.model} cacheRead`);
    assert.equal(f.label, e.label, `${e.model} label`);
    assert.equal(f.maxInput, e.maxInput, `${e.model} maxInput`);
    assert.deepEqual(JSON.parse(JSON.stringify(f.history ?? [])), e.history, `${e.model} dated periods`);
  }
});

test('switching the price source to the engine table changes no amount', async () => {
  const usage = {
    input_tokens: 1000, output_tokens: 2000,
    cache_creation_input_tokens: 10000, cache_read_input_tokens: 100000,
    cache_creation: { ephemeral_5m_input_tokens: 4000, ephemeral_1h_input_tokens: 6000 },
  };
  const before = computeCost(usage, 'claude-opus-4-8');
  assert.ok(Math.abs(before - 0.19) < 1e-12, `reference cost, got ${before}`);
  const { priceTable } = await loadEngine();
  applyEnginePrices(priceTable());
  try {
    assert.equal(computeCost(usage, 'claude-opus-4-8'), before);
    // The dated tariff still applies from the engine-fed entries.
    const intro = computeCost({ input_tokens: 1000 }, 'claude-sonnet-5', '2026-08-15T00:00:00.000Z');
    assert.ok(Math.abs(intro - 0.002) < 1e-12, `intro rate, got ${intro}`);
  } finally {
    _setPricesForTest({});
  }
});

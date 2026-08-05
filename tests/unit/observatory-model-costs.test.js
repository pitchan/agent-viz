'use strict';
// Per-model aggregation for the pricing panel: dollars come from the engine's
// costByModel, never recomputed from token buckets. "Sum of rows = total"
// must hold for what is displayed.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { computeModelCosts } = require('../../lib/server/observatory/model-costs');

const bucket = (inTok, out, cc = 0, cr = 0) =>
  ({ in: inTok, out, cacheCreate: cc, cacheRead: cr, cacheCreate1h: 0, cacheCreate5m: 0 });

function session({ id, netTokens, costUsd, costComplete = true, perModel, costByModel, cacheRead = 0, unknownModels = [] }) {
  return { id, netTokens, costUsd, costComplete,
    report: { tokens: { perModel, costByModel, total: { cacheRead }, unknownModels } } };
}

const A = session({
  id: 'a', netTokens: 6000, costUsd: 0.066, cacheRead: 500,
  perModel: { 'claude-opus-4-8': bucket(1000, 2000), 'claude-haiku-4-5': bucket(1000, 2000) },
  costByModel: {
    'claude-opus-4-8': { usd: 0.055, pricing: 'tarife' },
    'claude-haiku-4-5': { usd: 0.011, pricing: 'tarife' },
  },
});
const B = session({
  id: 'b', netTokens: 500, costUsd: 0.0025, cacheRead: 100,
  perModel: { 'claude-opus-4-8': bucket(500, 0) },
  costByModel: { 'claude-opus-4-8': { usd: 0.0025, pricing: 'tarife' } },
});
const C = session({
  id: 'c', netTokens: 700, costUsd: 0, costComplete: false, unknownModels: ['claude-futur-9'],
  perModel: { 'claude-futur-9': bucket(700, 0) },
  costByModel: { 'claude-futur-9': { usd: null, pricing: 'inconnu' } },
});

test('aggregates buckets, dollars and session counts per model across sessions', () => {
  const r = computeModelCosts([A, B]);
  const opus = r.models.find(m => m.model === 'claude-opus-4-8');
  assert.equal(opus.bucket.in, 1500);
  assert.equal(opus.bucket.out, 2000);
  assert.ok(Math.abs(opus.costUsd - 0.0575) < 1e-12);
  assert.equal(opus.sessions, 2);
  assert.equal(opus.netTokens, 3500);
});

test('the displayed invariant holds: sum of model dollars = totals, to the cent', () => {
  const r = computeModelCosts([A, B]);
  const sum = r.models.reduce((acc, m) => acc + (m.costUsd ?? 0), 0);
  assert.ok(Math.abs(sum - r.totals.costUsd) < 1e-9);
  assert.equal(r.totals.netTokens, 6500);
  assert.equal(r.totals.cacheReadTokens, 600);
  assert.equal(r.totals.costComplete, true);
});

test('sorted by descending dollars; unpriced models LAST by net tokens, usd stays null', () => {
  const r = computeModelCosts([A, B, C]);
  assert.deepEqual(r.models.map(m => m.model),
    ['claude-opus-4-8', 'claude-haiku-4-5', 'claude-futur-9']);
  const unknown = r.models[2];
  assert.equal(unknown.costUsd, null);
  assert.equal(unknown.pricing, 'inconnu');
  assert.equal(unknown.shareOfCost, null);
  assert.equal(r.totals.costComplete, false);
  assert.deepEqual(r.unknownModels, ['claude-futur-9']);
});

test('shares are computed over the displayed totals', () => {
  const r = computeModelCosts([A, B]);
  const opus = r.models.find(m => m.model === 'claude-opus-4-8');
  assert.ok(Math.abs(opus.shareOfNet - 3500 / 6500) < 1e-12);
  assert.ok(Math.abs(opus.shareOfCost - 0.0575 / 0.0685) < 1e-12);
});

test('a session scanned before SCAN_VERSION 6 is excluded from rows AND totals, and counted', () => {
  const legacy = { id: 'old', netTokens: 999, costUsd: 9, costComplete: true,
    report: { tokens: { perModel: {}, total: { cacheRead: 0 }, unknownModels: [] } } };
  const r = computeModelCosts([A, legacy]);
  assert.equal(r.excludedPendingRescan, 1);
  assert.equal(r.totals.netTokens, 6000);
  const sum = r.models.reduce((acc, m) => acc + (m.costUsd ?? 0), 0);
  assert.ok(Math.abs(sum - r.totals.costUsd) < 1e-9);
});

test('empty input yields zeros, not crashes', () => {
  const r = computeModelCosts([]);
  assert.deepEqual(r.models, []);
  assert.equal(r.totals.netTokens, 0);
  assert.equal(r.totals.costUsd, 0);
  assert.equal(r.excludedPendingRescan, 0);
});

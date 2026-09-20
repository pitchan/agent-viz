// Per-model aggregation for the pricing panel: dollars come from the engine's
// costByModel, never recomputed from token buckets. "Sum of rows = total"
// must hold for what is displayed.

import { expect, test } from 'vitest';
import { computeModelCosts } from '../../src/server/observatory/model-costs.ts';
import type { Session, TokenBucket } from '../../src/server/observatory/rules/types.ts';

const bucket = (inTok: number, out: number, cc = 0, cr = 0): TokenBucket =>
  ({ in: inTok, out, cacheCreate: cc, cacheRead: cr, cacheCreate1h: 0, cacheCreate5m: 0 });

interface SessionFixtureOpts {
  id: string;
  netTokens: number;
  costUsd: number;
  costComplete?: boolean;
  perModel: Record<string, TokenBucket>;
  costByModel: Record<string, { usd: number | null; pricing: string }>;
  cacheRead?: number;
  unknownModels?: string[];
}

function session({ id, netTokens, costUsd, costComplete = true, perModel, costByModel, cacheRead = 0, unknownModels = [] }: SessionFixtureOpts) {
  return { id, netTokens, costUsd, costComplete,
    report: { tokens: { perModel, costByModel, total: { cacheRead }, unknownModels } } } as unknown as Session;
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
  expect(opus!.bucket.in).toBe(1500);
  expect(opus!.bucket.out).toBe(2000);
  expect(Math.abs(opus!.costUsd! - 0.0575) < 1e-12).toBeTruthy();
  expect(opus!.sessions).toBe(2);
  expect(opus!.netTokens).toBe(3500);
});

test('the displayed invariant holds: sum of model dollars = totals, to the cent', () => {
  const r = computeModelCosts([A, B]);
  const sum = r.models.reduce((acc, m) => acc + (m.costUsd ?? 0), 0);
  expect(Math.abs(sum - r.totals.costUsd) < 1e-9).toBeTruthy();
  expect(r.totals.netTokens).toBe(6500);
  expect(r.totals.cacheReadTokens).toBe(600);
  expect(r.totals.costComplete).toBe(true);
});

test('sorted by descending dollars; unpriced models LAST by net tokens, usd stays null', () => {
  const r = computeModelCosts([A, B, C]);
  expect(r.models.map(m => m.model)).toEqual(['claude-opus-4-8', 'claude-haiku-4-5', 'claude-futur-9']);
  const unknown = r.models[2];
  expect(unknown!.costUsd).toBe(null);
  expect(unknown!.pricing).toBe('inconnu');
  expect(unknown!.shareOfCost).toBe(null);
  expect(r.totals.costComplete).toBe(false);
  expect(r.unknownModels).toEqual(['claude-futur-9']);
});

test('shares are computed over the displayed totals', () => {
  const r = computeModelCosts([A, B]);
  const opus = r.models.find(m => m.model === 'claude-opus-4-8');
  expect(Math.abs(opus!.shareOfNet - 3500 / 6500) < 1e-12).toBeTruthy();
  expect(Math.abs(opus!.shareOfCost! - 0.0575 / 0.0685) < 1e-12).toBeTruthy();
});

test('a session scanned before SCAN_VERSION 6 is excluded from rows AND totals, and counted', () => {
  const legacy = { id: 'old', netTokens: 999, costUsd: 9, costComplete: true,
    report: { tokens: { perModel: {}, total: { cacheRead: 0 }, unknownModels: [] } } } as unknown as Session;
  const r = computeModelCosts([A, legacy]);
  expect(r.excludedPendingRescan).toBe(1);
  expect(r.totals.netTokens).toBe(6000);
  const sum = r.models.reduce((acc, m) => acc + (m.costUsd ?? 0), 0);
  expect(Math.abs(sum - r.totals.costUsd) < 1e-9).toBeTruthy();
});

test('empty input yields zeros, not crashes', () => {
  const r = computeModelCosts([]);
  expect(r.models).toEqual([]);
  expect(r.totals.netTokens).toBe(0);
  expect(r.totals.costUsd).toBe(0);
  expect(r.excludedPendingRescan).toBe(0);
});

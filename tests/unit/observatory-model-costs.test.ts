// Per-model aggregation for the pricing panel: dollars come from the engine's
// costByModel, never recomputed from token buckets. "Sum of rows = total"
// must hold for what is displayed.

import { expect, test } from 'vitest';
import { computeModelCosts } from '../../src/server/observatory/model-costs.ts';
import type { Session, TokenBucket } from '../../src/server/observatory/rules/types.ts';

const bucket = (inTok: number, out: number, cc = 0, cr = 0): TokenBucket =>
  ({ in: inTok, out, cacheCreate: cc, cacheRead: cr, cacheCreate1h: 0, cacheCreate5m: 0 });

type CostEntry = { usd: number | null; fastUsd?: number; pricing: string };

interface SessionFixtureOpts {
  id: string;
  netTokens: number;
  costUsd: number;
  costComplete?: boolean;
  perModel: Record<string, TokenBucket>;
  costByModel: Record<string, CostEntry>;
  cacheRead?: number;
  unknownModels?: string[];
}

// fastUsd vaut 0 sauf quand un test le déclare : un modèle sans mode rapide n'en a pas.
const withFast = (cbm: Record<string, CostEntry>) =>
  Object.fromEntries(Object.entries(cbm).map(([k, v]) => [k, { fastUsd: 0, ...v }]));

function session({ id, netTokens, costUsd, costComplete = true, perModel, costByModel, cacheRead = 0, unknownModels = [] }: SessionFixtureOpts) {
  return { id, netTokens, costUsd, costComplete,
    report: { tokens: { perModel, costByModel: withFast(costByModel), total: { cacheRead }, unknownModels } } } as unknown as Session;
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

test('fastUsd est additionné par modèle et au total', () => {
  // Arrange
  const rapide = session({
    id: 'f', netTokens: 1000, costUsd: 0.012,
    perModel: { 'claude-opus-5-5': bucket(2000, 0) },
    costByModel: { 'claude-opus-5-5': { usd: 0.012, fastUsd: 0.008, pricing: 'tarife' } },
  });

  // Act
  const r = computeModelCosts([A, rapide]);

  // Assert
  expect(r.models.find(m => m.model === 'claude-opus-5-5')?.fastUsd).toBeCloseTo(0.008, 12);
  expect(r.models.find(m => m.model === 'claude-opus-4-8')?.fastUsd).toBe(0);
  expect(r.totals.fastUsd).toBeCloseTo(0.008, 12);
});

test('une session au tarif inconnu rend inconnue la ligne du modèle, quel que soit l’ordre', () => {
  // Arrange
  const partielle = session({
    id: 'p', netTokens: 1000, costUsd: 0.002, costComplete: false, unknownModels: ['claude-sonnet-5'],
    perModel: { 'claude-sonnet-5': bucket(1000, 0) },
    costByModel: { 'claude-sonnet-5': { usd: 0.002, pricing: 'inconnu' } },
  });
  const complete = session({
    id: 'q', netTokens: 1000, costUsd: 0.002,
    perModel: { 'claude-sonnet-5': bucket(1000, 0) },
    costByModel: { 'claude-sonnet-5': { usd: 0.002, pricing: 'tarife' } },
  });

  // Act
  const r = computeModelCosts([complete, partielle]);

  // Assert
  expect(r.models.find(m => m.model === 'claude-sonnet-5')?.pricing).toBe('inconnu');
});

test('une ligne au tarif inconnu n’a pas de part de coût, même avec des dollars partiels', () => {
  // Arrange
  const partielle = session({
    id: 'p2', netTokens: 1000, costUsd: 0.002, costComplete: false, unknownModels: ['claude-sonnet-5'],
    perModel: { 'claude-sonnet-5': bucket(1000, 0) },
    costByModel: { 'claude-sonnet-5': { usd: 0.002, pricing: 'inconnu' } },
  });

  // Act
  const r = computeModelCosts([A, partielle]);

  // Assert
  expect(r.models.find(m => m.model === 'claude-sonnet-5')?.shareOfCost).toBe(null);
});

test('une ligne au tarif inconnu se classe après les lignes tarifées, même avec plus de dollars', () => {
  // Arrange
  const grosseInconnue = session({
    id: 'g', netTokens: 50, costUsd: 5, costComplete: false, unknownModels: ['claude-sonnet-5'],
    perModel: { 'claude-sonnet-5': bucket(50, 0) },
    costByModel: { 'claude-sonnet-5': { usd: 5, pricing: 'inconnu' } },
  });

  // Act
  const r = computeModelCosts([A, grosseInconnue]);

  // Assert
  expect(r.models.map(m => m.model)).toEqual(['claude-opus-4-8', 'claude-haiku-4-5', 'claude-sonnet-5']);
});

test('une session sans fastUsd sur une entrée costByModel est écartée des lignes ET des totaux, et comptée', () => {
  // Arrange
  const avantFastUsd = session({
    id: 'old-fast', netTokens: 900, costUsd: 0.009,
    perModel: { 'claude-opus-4-8': bucket(900, 0) },
    costByModel: { 'claude-opus-4-8': { usd: 0.009, fastUsd: undefined, pricing: 'tarife' } },
  });

  // Act
  const r = computeModelCosts([A, avantFastUsd]);

  // Assert
  expect(r.excludedPendingRescan).toBe(1);
  expect(r.totals.netTokens).toBe(6000);
  expect(Number.isFinite(r.totals.fastUsd)).toBe(true);
});

test('empty input yields zeros, not crashes', () => {
  const r = computeModelCosts([]);
  expect(r.models).toEqual([]);
  expect(r.totals.netTokens).toBe(0);
  expect(r.totals.costUsd).toBe(0);
  expect(r.excludedPendingRescan).toBe(0);
});

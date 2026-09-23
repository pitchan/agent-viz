// priceTable expose le barème réellement appliqué : la pastille et les cartes le lisent
// tel quel. Purement descriptif — l'exposer ne change aucun montant rendu par computeCost.
import { expect, test } from 'vitest';
import { computeCost, priceTable } from '../../src/engine/core/pricing.ts';

test('source, unité, et les 12 modèles de la table courante', () => {
  const t = priceTable();
  expect(t.source).toBe('netgain-table-embarquee');
  expect(t.unit).toBe('usd-par-jeton');
  expect(t.entries.map((e) => e.model).sort()).toEqual([
    'claude-fable-5', 'claude-fable-5-1', 'claude-haiku-4-5', 'claude-mythos-5', 'claude-opus-4-5',
    'claude-opus-4-6', 'claude-opus-4-7', 'claude-opus-4-8', 'claude-opus-5',
    'claude-sonnet-4-5', 'claude-sonnet-4-6', 'claude-sonnet-5',
  ]);
});

test('sonnet-5 porte sa période datée ; un modèle sans histoire a une liste vide', () => {
  const t = priceTable();
  const sonnet = t.entries.find((e) => e.model === 'claude-sonnet-5');
  expect(sonnet?.current.input).toBe(3e-6);
  expect(sonnet?.history).toEqual([
    { until: '2026-09-01', prices: { input: 2e-6, output: 1e-5, cacheCreate: 2.5e-6, cacheRead: 2e-7 } },
  ]);
  expect(t.entries.find((e) => e.model === 'claude-fable-5')?.history).toEqual([]);
});

test('zeroCost liste les modèles à zéro voulu AVEC leurs raisons', () => {
  const t = priceTable();
  expect(t.zeroCost.map((z) => z.model).sort()).toEqual(['<synthetic>', 'ministral-3:latest']);
  for (const z of t.zeroCost) expect(z.reason.length).toBeGreaterThan(0);
});

test('libellés et fenêtres de contexte : les champs que la pastille consomme', () => {
  const t = priceTable();
  const of = (m: string) => t.entries.find((e) => e.model === m);
  expect(of('claude-opus-5')).toMatchObject({ label: 'Opus 5', maxInput: 1_000_000 });
  expect(of('claude-opus-4-7')).toMatchObject({ label: 'Opus 4.7', maxInput: 1_000_000 });
  expect(of('claude-opus-4-5')).toMatchObject({ label: 'Opus 4.5', maxInput: 200_000 });
  expect(of('claude-haiku-4-5')).toMatchObject({ label: 'Haiku 4.5', maxInput: 200_000 });
  for (const e of t.entries) {
    expect(e.label.length).toBeGreaterThan(0);
    expect(e.maxInput).toBeGreaterThan(0);
  }
});

test('immuable de fait : muter le retour ne change pas un second appel', () => {
  const reference = JSON.parse(JSON.stringify(priceTable()));
  const t = priceTable();
  const fable = t.entries.find((e) => e.model === 'claude-fable-5');
  expect(fable).toBeDefined();
  if (fable) fable.current.input = 999;
  t.entries.pop();
  t.zeroCost.length = 0;
  expect(JSON.parse(JSON.stringify(priceTable()))).toEqual(reference);
});

test('purement descriptif : computeCost rend le même montant après exposition', () => {
  priceTable();
  const r = computeCost({
    input_tokens: 1000, output_tokens: 2000,
    cache_creation_input_tokens: 10000, cache_read_input_tokens: 100000,
    cache_creation: { ephemeral_5m_input_tokens: 4000, ephemeral_1h_input_tokens: 6000 },
  }, 'claude-opus-4-8');
  expect(r.usd).toBeCloseTo(0.19, 12);
});

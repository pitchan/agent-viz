// costByModel ventile le coût par modèle : un même transcript peut mêler plusieurs
// modèles, et le tarif appliqué dépend de la date du message.
import { expect, test } from 'vitest';
import { embeddedPricing } from '../../src/engine/core/pricing.ts';
import { TokensAggregator } from '../../src/engine/doctor/aggregators/tokens.ts';
import { assistant } from '../helpers/tokens-events.ts';
import { pricingAvecHausse } from '../helpers/tariff-change.ts';

test('invariant au centime : la somme des usd non nuls vaut costUsd', () => {
  const agg = new TokensAggregator(embeddedPricing);
  agg.addAssistant(assistant({ msgId: 'c1', model: 'claude-opus-4-8', usage: { input_tokens: 1000, output_tokens: 2000 } }), 'main');
  agg.addAssistant(assistant({ msgId: 'c2', model: 'claude-haiku-4-5', usage: { input_tokens: 1000, output_tokens: 2000 } }), 'agent-x');
  agg.addAssistant(assistant({ msgId: 'c3', model: 'claude-futur-9', usage: { input_tokens: 500 } }), 'main');
  const r = agg.result();
  const somme = Object.values(r.costByModel).reduce((acc, m) => acc + (m.usd ?? 0), 0);
  expect(somme).toBeCloseTo(r.costUsd, 10);
  // opus : 1000×5e-6 + 2000×2.5e-5 = 0.055 ; haiku : 1000×1e-6 + 2000×5e-6 = 0.011
  expect(r.costByModel['claude-opus-4-8']?.usd).toBeCloseTo(0.055, 10);
  expect(r.costByModel['claude-haiku-4-5']?.usd).toBeCloseTo(0.011, 10);
});

test('tarif daté PAR MODÈLE : les deux barèmes sonnet-5 s’additionnent, pas 2× le courant', () => {
  // C'est le test qui justifie de modifier le moteur plutôt que de recalculer
  // en aval : un seau agrégé ne sait plus dater ses messages.
  const agg = new TokensAggregator(pricingAvecHausse);
  agg.addAssistant(assistant({ msgId: 'd1', model: 'claude-sonnet-5', usage: { input_tokens: 1000, output_tokens: 0 }, timestamp: '2026-08-15T10:00:00.000Z' }), 'main');
  agg.addAssistant(assistant({ msgId: 'd2', model: 'claude-sonnet-5', usage: { input_tokens: 1000, output_tokens: 0 }, timestamp: '2026-09-15T10:00:00.000Z' }), 'main');
  const r = agg.result();
  // 1000×2e-6 (avant) + 1000×3e-6 (après) = 0.005 — ni 0.004 ni 0.006.
  expect(r.costByModel['claude-sonnet-5']?.usd).toBeCloseTo(0.005, 12);
  expect(r.costByModel['claude-sonnet-5']?.pricing).toBe('tarife');
});

test('zéro voulu : usd 0, pricing zero-voulu', () => {
  const agg = new TokensAggregator(embeddedPricing);
  agg.addAssistant(assistant({ msgId: 'z1', model: '<synthetic>', usage: { input_tokens: 50 } }), 'main');
  expect(agg.result().costByModel['<synthetic>']).toEqual({ usd: 0, fastUsd: 0, pricing: 'zero-voulu' });
});

test('modèle inconnu : usd null, pricing inconnu, PRÉSENT dans costByModel', () => {
  const agg = new TokensAggregator(embeddedPricing);
  agg.addAssistant(assistant({ msgId: 'u1', model: 'claude-futur-9', usage: { input_tokens: 500 } }), 'main');
  const r = agg.result();
  expect(r.costByModel['claude-futur-9']).toEqual({ usd: null, fastUsd: 0, pricing: 'inconnu' });
  expect(r.unknownModels).toEqual(['claude-futur-9']);
  expect(r.costUsd).toBe(0);
});

test('non-régression : costByModel a exactement les clés de perModel', () => {
  const agg = new TokensAggregator(embeddedPricing);
  agg.addAssistant(assistant({ msgId: 'n1', model: 'claude-opus-4-8' }), 'main');
  agg.addAssistant(assistant({ msgId: 'n2', model: 'claude-futur-9' }), 'main');
  const r = agg.result();
  expect(Object.keys(r.costByModel).sort()).toEqual(Object.keys(r.perModel).sort());
});

// Un message malformé sur un modèle tarifé ne doit poisonner ni costUsd ni
// costByModel pour le reste de la session : les deux restent finis. costComplete
// devient faux, parce que ce message n'est pas tarifé, sans nommer aucun modèle inconnu.
test('un message malformé (input_tokens: 1e999) entre deux sains ne poisonne ni costUsd ni costByModel', () => {
  const agg = new TokensAggregator(embeddedPricing);
  const sain = { input_tokens: 1000, output_tokens: 2000 };
  agg.addAssistant(assistant({ msgId: 'm1', model: 'claude-opus-4-8', usage: sain }), 'main');
  const coutUnSain = agg.result().costUsd;
  agg.addAssistant(
    assistant({
      msgId: 'm2',
      model: 'claude-opus-4-8',
      usage: JSON.parse('{"input_tokens":1e999}'),
      usageVerdict: 'malforme',
    }),
    'main',
  );
  agg.addAssistant(assistant({ msgId: 'm3', model: 'claude-opus-4-8', usage: sain }), 'main');
  const r = agg.result();
  expect(Number.isFinite(r.costUsd)).toBe(true);
  expect(r.costUsd).toBeCloseTo(coutUnSain * 2, 12);
  expect(r.costByModel['claude-opus-4-8']?.usd).toBeCloseTo(coutUnSain * 2, 12);
  expect(r.costComplete).toBe(false);
  expect(r.malformedUsageMessages).toBe(1);
  expect(r.unknownModels).toEqual([]);
});

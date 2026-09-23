import { expect, test } from 'vitest';
import { embeddedPricing } from '../../src/engine/core/pricing.ts';
import { netTokens, TokensAggregator } from '../../src/engine/doctor/aggregators/tokens.ts';
import { assistant } from '../helpers/tokens-events.ts';

test('déduplique par message.id : une ligne par content block, un seul comptage', () => {
  const agg = new TokensAggregator(embeddedPricing);
  const evt = assistant({ msgId: 'msg_dup', usage: { input_tokens: 100, output_tokens: 50 } });
  agg.addAssistant(evt, 'main');
  agg.addAssistant(evt, 'main');
  agg.addAssistant(evt, 'main');
  const r = agg.result();
  expect(r.main.in).toBe(100);
  expect(r.main.out).toBe(50);
});

test('accumule des messages distincts, ventilés par modèle', () => {
  const agg = new TokensAggregator(embeddedPricing);
  agg.addAssistant(assistant({ msgId: 'm1', model: 'claude-opus-4-8', usage: { input_tokens: 10, output_tokens: 1 } }), 'main');
  agg.addAssistant(assistant({ msgId: 'm2', model: 'claude-haiku-4-5', usage: { input_tokens: 20, output_tokens: 2 } }), 'main');
  const r = agg.result();
  expect(r.perModel['claude-opus-4-8']?.in).toBe(10);
  expect(r.perModel['claude-haiku-4-5']?.in).toBe(20);
  expect(r.main.in).toBe(30);
});

test('buckets sous-agents séparés du main, total = main + agents', () => {
  const agg = new TokensAggregator(embeddedPricing);
  agg.addAssistant(assistant({ msgId: 'm1', usage: { input_tokens: 10, output_tokens: 0 } }), 'main');
  agg.addAssistant(assistant({ msgId: 'a1', usage: { input_tokens: 7, output_tokens: 0 } }), 'agent-abc');
  const r = agg.result();
  expect(r.main.in).toBe(10);
  expect(r.perAgent['agent-abc']?.in).toBe(7);
  expect(r.total.in).toBe(17);
});

test('netTokens = input + cache_creation + output, cache_read EXCLU', () => {
  const agg = new TokensAggregator(embeddedPricing);
  agg.addAssistant(
    assistant({
      msgId: 'm1',
      usage: { input_tokens: 100, output_tokens: 30, cache_creation_input_tokens: 500, cache_read_input_tokens: 99999 },
    }),
    'main',
  );
  const r = agg.result();
  expect(netTokens(r.total)).toBe(630);
  expect(r.total.cacheRead).toBe(99999);
});

test('coût : somme au prix du modèle réel de chaque message', () => {
  const agg = new TokensAggregator(embeddedPricing);
  agg.addAssistant(
    assistant({ msgId: 'm1', model: 'claude-opus-4-8', usage: { input_tokens: 1000, output_tokens: 2000 } }),
    'main',
  );
  agg.addAssistant(
    assistant({ msgId: 'm2', model: 'claude-haiku-4-5', usage: { input_tokens: 1000, output_tokens: 2000 } }),
    'agent-x',
  );
  const r = agg.result();
  // opus : 1000×5e-6 + 2000×2.5e-5 = 0.055 ; haiku : 1000×1e-6 + 2000×5e-6 = 0.011
  expect(r.costUsd).toBeCloseTo(0.066, 10);
  expect(r.costComplete).toBe(true);
  expect(r.unknownModels).toEqual([]);
  expect(r.malformedUsageMessages).toBe(0);
});

test('modèle inconnu : tokens comptés, coût incomplet signalé, jamais un zéro silencieux', () => {
  const agg = new TokensAggregator(embeddedPricing);
  agg.addAssistant(
    assistant({ msgId: 'm1', model: 'claude-opus-4-8', usage: { input_tokens: 1000, output_tokens: 2000 } }),
    'main',
  );
  agg.addAssistant(
    assistant({ msgId: 'm2', model: 'claude-futur-9', usage: { input_tokens: 500, output_tokens: 100 } }),
    'main',
  );
  const r = agg.result();
  expect(r.main.in).toBe(1500);
  expect(r.costUsd).toBeCloseTo(0.055, 10); // la part connue seulement
  expect(r.costComplete).toBe(false);
  expect(r.unknownModels).toEqual(['claude-futur-9']);
});

test('le coût est calculé au tarif en vigueur à la date du message, pas à la date du scan', () => {
  // sonnet-5 change de tarif le 2026-09-01 (2→3 $/M en entrée). Un message
  // horodaté septembre doit être facturé au catalogue même si le scan tourne
  // pendant la fenêtre de lancement.
  const agg = new TokensAggregator(embeddedPricing);
  agg.addAssistant(
    assistant({
      msgId: 'm1',
      model: 'claude-sonnet-5',
      usage: { input_tokens: 1000, output_tokens: 0 },
      timestamp: '2026-09-15T10:00:00.000Z',
    }),
    'main',
  );
  expect(agg.result().costUsd).toBeCloseTo(0.003, 12); // 1000 × 3e-6, pas 2e-6
});

test('usage null ou msgId null : compté sans dédup, sans throw', () => {
  const agg = new TokensAggregator(embeddedPricing);
  agg.addAssistant(assistant({ msgId: null, usage: { input_tokens: 1, output_tokens: 0 } }), 'main');
  agg.addAssistant(assistant({ msgId: null, usage: { input_tokens: 1, output_tokens: 0 } }), 'main');
  const noUsage = assistant({ msgId: 'm9' });
  noUsage.usage = null;
  agg.addAssistant(noUsage, 'main');
  expect(agg.result().main.in).toBe(2);
});

test('usage non objet (normalisé en null) : aucun jeton ni aucun dollar compté', () => {
  // Arrange
  const agg = new TokensAggregator(embeddedPricing);
  const nonObjet = assistant({ msgId: 'mx', usageVerdict: 'malforme' });
  nonObjet.usage = null;

  // Act
  agg.addAssistant(nonObjet, 'main');
  const r = agg.result();

  // Assert
  expect(netTokens(r.total)).toBe(0);
  expect(r.total.cacheRead).toBe(0);
  expect(r.costUsd).toBe(0);
});

test('un compte négatif ne retranche rien : les champs valides du même message restent comptés', () => {
  // Arrange
  const agg = new TokensAggregator(embeddedPricing);
  const evt = assistant({
    msgId: 'mn',
    model: 'claude-opus-4-8',
    usage: { input_tokens: -1000, output_tokens: 2000 },
    usageVerdict: 'malforme',
  });

  // Act
  agg.addAssistant(evt, 'main');
  const r = agg.result();

  // Assert — opus : 2000×2.5e-5 = 0.05, l'entrée négative ne vaut ni jeton ni dollar
  expect(r.main.in).toBe(0);
  expect(r.main.out).toBe(2000);
  expect(r.costUsd).toBeCloseTo(0.05, 12);
});

test('un usage non objet rend jetons et coût partiels et se compte à part, sans nommer de modèle', () => {
  // Arrange
  const agg = new TokensAggregator(embeddedPricing);
  const nonObjet = assistant({ msgId: 'mx', usageVerdict: 'malforme' });
  nonObjet.usage = null;

  // Act
  agg.addAssistant(nonObjet, 'main');
  const r = agg.result();

  // Assert
  expect(r.costComplete).toBe(false);
  expect(r.malformedUsageMessages).toBe(1);
  expect(r.unknownModels).toEqual([]);
});

test('un message malformé écrit sur plusieurs lignes n’est compté qu’une fois', () => {
  // Arrange
  const agg = new TokensAggregator(embeddedPricing);
  const evt = assistant({ msgId: 'md', usage: { input_tokens: -1, output_tokens: 5 }, usageVerdict: 'malforme' });
  agg.addAssistant(evt, 'main');

  // Act
  agg.addAssistant(evt, 'main');
  const r = agg.result();

  // Assert
  expect(r.malformedUsageMessages).toBe(1);
});

test('une ligne sans usage ne rend pas la session partielle', () => {
  // Arrange
  const agg = new TokensAggregator(embeddedPricing);
  const sansUsage = assistant({ msgId: 'ma', usageVerdict: 'absent' });
  sansUsage.usage = null;

  // Act
  agg.addAssistant(sansUsage, 'main');
  const r = agg.result();

  // Assert
  expect(r.costComplete).toBe(true);
  expect(r.malformedUsageMessages).toBe(0);
});

test('un modèle à zéro voulu ne rend pas le coût partiel', () => {
  const agg = new TokensAggregator(embeddedPricing);
  agg.addAssistant(
    assistant({
      msgId: 'zc1',
      model: 'claude-fable-5',
      usage: { input_tokens: 100, output_tokens: 10 },
      timestamp: '2026-08-04T10:00:00.000Z',
    }),
    'main',
  );
  agg.addAssistant(
    assistant({
      msgId: 'zc2',
      model: '<synthetic>',
      usage: { input_tokens: 50 },
      timestamp: '2026-08-04T10:00:01.000Z',
    }),
    'main',
  );
  const r = agg.result();
  expect(r.costComplete).toBe(true);
  expect(r.unknownModels).toEqual([]);
  expect(r.malformedUsageMessages).toBe(0);
});

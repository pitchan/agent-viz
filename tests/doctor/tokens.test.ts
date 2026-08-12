import { describe, expect, test } from 'vitest';
import type { NormalizedEvent } from '../../src/engine/core/events.js';
import { netTokens, TokensAggregator } from '../../src/engine/doctor/aggregators/tokens.js';

function assistant(over: {
  msgId?: string | null;
  model?: string;
  usage?: Record<string, number>;
  timestamp?: string;
}): Extract<NormalizedEvent, { kind: 'assistant' }> {
  return {
    kind: 'assistant',
    msgId: over.msgId === undefined ? 'msg_x' : over.msgId,
    model: over.model ?? 'claude-opus-4-8',
    usage: over.usage ?? { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    toolUses: [],
    textChars: 0,
    ...(over.timestamp !== undefined ? { timestamp: over.timestamp } : {}),
    isSidechain: false,
  };
}

describe('TokensAggregator', () => {
  test('déduplique par message.id : une ligne par content block, un seul comptage', () => {
    const agg = new TokensAggregator();
    const evt = assistant({ msgId: 'msg_dup', usage: { input_tokens: 100, output_tokens: 50 } });
    agg.addAssistant(evt, 'main');
    agg.addAssistant(evt, 'main');
    agg.addAssistant(evt, 'main');
    const r = agg.result();
    expect(r.main.in).toBe(100);
    expect(r.main.out).toBe(50);
  });

  test('accumule des messages distincts, ventilés par modèle', () => {
    const agg = new TokensAggregator();
    agg.addAssistant(assistant({ msgId: 'm1', model: 'claude-opus-4-8', usage: { input_tokens: 10, output_tokens: 1 } }), 'main');
    agg.addAssistant(assistant({ msgId: 'm2', model: 'claude-haiku-4-5', usage: { input_tokens: 20, output_tokens: 2 } }), 'main');
    const r = agg.result();
    expect(r.perModel['claude-opus-4-8']?.in).toBe(10);
    expect(r.perModel['claude-haiku-4-5']?.in).toBe(20);
    expect(r.main.in).toBe(30);
  });

  test('buckets sous-agents séparés du main, total = main + agents', () => {
    const agg = new TokensAggregator();
    agg.addAssistant(assistant({ msgId: 'm1', usage: { input_tokens: 10, output_tokens: 0 } }), 'main');
    agg.addAssistant(assistant({ msgId: 'a1', usage: { input_tokens: 7, output_tokens: 0 } }), 'agent-abc');
    const r = agg.result();
    expect(r.main.in).toBe(10);
    expect(r.perAgent['agent-abc']?.in).toBe(7);
    expect(r.total.in).toBe(17);
  });

  test('netTokens = input + cache_creation + output, cache_read EXCLU', () => {
    const agg = new TokensAggregator();
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
    const agg = new TokensAggregator();
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
  });

  test('modèle inconnu : tokens comptés, coût incomplet signalé, jamais un zéro silencieux', () => {
    const agg = new TokensAggregator();
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
    const agg = new TokensAggregator();
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
    const agg = new TokensAggregator();
    agg.addAssistant(assistant({ msgId: null, usage: { input_tokens: 1, output_tokens: 0 } }), 'main');
    agg.addAssistant(assistant({ msgId: null, usage: { input_tokens: 1, output_tokens: 0 } }), 'main');
    const noUsage = assistant({ msgId: 'm9' });
    noUsage.usage = null;
    agg.addAssistant(noUsage, 'main');
    expect(agg.result().main.in).toBe(2);
  });

  test('un modèle à zéro voulu ne rend pas le coût partiel', () => {
    const agg = new TokensAggregator();
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
  });
});

describe('TokensAggregator — coût par modèle (costByModel)', () => {
  test('invariant au centime : la somme des usd non nuls vaut costUsd', () => {
    const agg = new TokensAggregator();
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
    const agg = new TokensAggregator();
    agg.addAssistant(assistant({ msgId: 'd1', model: 'claude-sonnet-5', usage: { input_tokens: 1000, output_tokens: 0 }, timestamp: '2026-08-15T10:00:00.000Z' }), 'main');
    agg.addAssistant(assistant({ msgId: 'd2', model: 'claude-sonnet-5', usage: { input_tokens: 1000, output_tokens: 0 }, timestamp: '2026-09-15T10:00:00.000Z' }), 'main');
    const r = agg.result();
    // 1000×2e-6 (lancement) + 1000×3e-6 (catalogue) = 0.005 — ni 0.004 ni 0.006.
    expect(r.costByModel['claude-sonnet-5']?.usd).toBeCloseTo(0.005, 12);
    expect(r.costByModel['claude-sonnet-5']?.pricing).toBe('tarife');
  });

  test('zéro voulu : usd 0, pricing zero-voulu', () => {
    const agg = new TokensAggregator();
    agg.addAssistant(assistant({ msgId: 'z1', model: '<synthetic>', usage: { input_tokens: 50 } }), 'main');
    expect(agg.result().costByModel['<synthetic>']).toEqual({ usd: 0, pricing: 'zero-voulu' });
  });

  test('modèle inconnu : usd null, pricing inconnu, PRÉSENT dans costByModel', () => {
    const agg = new TokensAggregator();
    agg.addAssistant(assistant({ msgId: 'u1', model: 'claude-futur-9', usage: { input_tokens: 500 } }), 'main');
    const r = agg.result();
    expect(r.costByModel['claude-futur-9']).toEqual({ usd: null, pricing: 'inconnu' });
    expect(r.unknownModels).toEqual(['claude-futur-9']);
    expect(r.costUsd).toBe(0);
  });

  test('non-régression : costByModel a exactement les clés de perModel', () => {
    const agg = new TokensAggregator();
    agg.addAssistant(assistant({ msgId: 'n1', model: 'claude-opus-4-8' }), 'main');
    agg.addAssistant(assistant({ msgId: 'n2', model: 'claude-futur-9' }), 'main');
    const r = agg.result();
    expect(Object.keys(r.costByModel).sort()).toEqual(Object.keys(r.perModel).sort());
  });
});

import { describe, expect, test } from 'vitest';
import { computeCost, normalizeModel, priceTable, pricingKindOf } from '../../src/core/pricing.js';

describe('normalizeModel', () => {
  test('retire suffixe [1m], préfixes transport, dates et versions', () => {
    expect(normalizeModel('claude-opus-4-8[1m]')).toBe('claude-opus-4-8');
    expect(normalizeModel('anthropic/claude-opus-4-8')).toBe('claude-opus-4-8');
    expect(normalizeModel('bedrock/claude-opus-4-7-v1:0')).toBe('claude-opus-4-7');
    expect(normalizeModel('claude-sonnet-4-5-20250929')).toBe('claude-sonnet-4-5');
    expect(normalizeModel('claude-haiku-4-5@20251001')).toBe('claude-haiku-4-5');
    expect(normalizeModel(null)).toBeNull();
    expect(normalizeModel('')).toBeNull();
  });
});

describe('computeCost — formule agent-viz reproduite à l’identique', () => {
  test('avec split cache_creation : 1h à 2× input, 5m à cacheCreate', () => {
    const usage = {
      input_tokens: 1000,
      output_tokens: 2000,
      cache_creation_input_tokens: 10000,
      cache_read_input_tokens: 100000,
      cache_creation: { ephemeral_5m_input_tokens: 4000, ephemeral_1h_input_tokens: 6000 },
    };
    // 1000×5e-6 + 2000×2.5e-5 + 4000×6.25e-6 + 6000×(5e-6×2) + 100000×5e-7
    // = 0.005 + 0.05 + 0.025 + 0.06 + 0.05 = 0.19
    const r = computeCost(usage, 'claude-opus-4-8');
    expect(r.known).toBe(true);
    expect(r.model).toBe('claude-opus-4-8');
    expect(r.usd).toBeCloseTo(0.19, 12);
  });

  test('sans split : tout le cache_creation au tarif 5m', () => {
    const usage = {
      input_tokens: 1000,
      output_tokens: 2000,
      cache_creation_input_tokens: 10000,
      cache_read_input_tokens: 100000,
    };
    // 0.005 + 0.05 + 10000×6.25e-6 + 0.05 = 0.1675
    const r = computeCost(usage, 'claude-opus-4-8');
    expect(r.known).toBe(true);
    expect(r.usd).toBeCloseTo(0.1675, 12);
  });

  test('modèle inconnu → coût null, jamais un zéro silencieux', () => {
    expect(computeCost({ input_tokens: 10 }, 'claude-futur-9')).toEqual({
      usd: null,
      known: false,
      model: 'claude-futur-9',
    });
    expect(computeCost({ input_tokens: 10 }, null)).toEqual({ usd: null, known: false, model: null });
  });
});

describe('computeCost — famille Claude 5 (tarifs publics 2026, prix catalogue)', () => {
  const usage = {
    input_tokens: 1000,
    output_tokens: 2000,
    cache_creation_input_tokens: 10000,
    cache_read_input_tokens: 100000,
    cache_creation: { ephemeral_5m_input_tokens: 4000, ephemeral_1h_input_tokens: 6000 },
  };

  test('claude-fable-5 : 10 $/M entrée, 50 $/M sortie', () => {
    // 1000×1e-5 + 2000×5e-5 + 4000×1.25e-5 + 6000×(1e-5×2) + 100000×1e-6
    // = 0.01 + 0.1 + 0.05 + 0.12 + 0.1 = 0.38
    const r = computeCost(usage, 'claude-fable-5');
    expect(r.known).toBe(true);
    expect(r.usd).toBeCloseTo(0.38, 12);
  });

  test('claude-mythos-5 : mêmes tarifs que fable-5', () => {
    const r = computeCost(usage, 'claude-mythos-5');
    expect(r.known).toBe(true);
    expect(r.usd).toBeCloseTo(0.38, 12);
  });

  test('claude-opus-5 : mêmes tarifs qu’opus-4-8 (5 $/M, 25 $/M)', () => {
    const r = computeCost(usage, 'claude-opus-5');
    expect(r.known).toBe(true);
    expect(r.usd).toBeCloseTo(0.19, 12);
  });

  test('claude-sonnet-5 après le 2026-09-01 : prix catalogue 3 $/M entrée, 15 $/M sortie', () => {
    // 0.003 + 0.03 + 4000×3.75e-6 + 6000×6e-6 + 0.03 = 0.114
    const r = computeCost(usage, 'claude-sonnet-5', '2026-09-01T00:00:00.000Z');
    expect(r.known).toBe(true);
    expect(r.usd).toBeCloseTo(0.114, 12);
  });

  test('contre-preuve carte observatoire : 1,2 M jetons cache 1h sur fable-5 = 24 $', () => {
    const r = computeCost(
      {
        cache_creation_input_tokens: 1_200_000,
        cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 1_200_000 },
      },
      'claude-fable-5',
    );
    expect(r.usd).toBeCloseTo(24.0, 9);
  });
});

describe('computeCost — historique des barèmes (tarif en vigueur à la date du message)', () => {
  const usage = {
    input_tokens: 1000,
    output_tokens: 2000,
    cache_creation_input_tokens: 10000,
    cache_read_input_tokens: 100000,
    cache_creation: { ephemeral_5m_input_tokens: 4000, ephemeral_1h_input_tokens: 6000 },
  };

  test('claude-sonnet-5 daté d’août 2026 : tarif de lancement 2 $/M entrée, 10 $/M sortie', () => {
    // 1000×2e-6 + 2000×1e-5 + 4000×2.5e-6 + 6000×(2e-6×2) + 100000×2e-7
    // = 0.002 + 0.02 + 0.01 + 0.024 + 0.02 = 0.076
    const r = computeCost(usage, 'claude-sonnet-5', '2026-08-15T12:00:00.000Z');
    expect(r.known).toBe(true);
    expect(r.usd).toBeCloseTo(0.076, 12);
  });

  test('la frontière est exclusive : dernier instant du 31/08 = lancement, minuit du 01/09 = catalogue', () => {
    const avant = computeCost(usage, 'claude-sonnet-5', '2026-08-31T23:59:59.999Z');
    const apres = computeCost(usage, 'claude-sonnet-5', '2026-09-01T00:00:00.000Z');
    expect(avant.usd).toBeCloseTo(0.076, 12);
    expect(apres.usd).toBeCloseTo(0.114, 12);
  });

  test('un modèle sans changement de tarif ignore la date (fable-5 identique à toute date)', () => {
    expect(computeCost(usage, 'claude-fable-5', '2026-08-15T12:00:00.000Z').usd).toBeCloseTo(0.38, 12);
    expect(computeCost(usage, 'claude-fable-5', '2027-01-01T00:00:00.000Z').usd).toBeCloseTo(0.38, 12);
  });

  test('sans date : tarif en vigueur maintenant (équivalent à at = new Date())', () => {
    const sans = computeCost(usage, 'claude-sonnet-5');
    const avec = computeCost(usage, 'claude-sonnet-5', new Date().toISOString());
    expect(sans.usd).toBe(avec.usd);
  });
});

describe('computeCost — zéro voulu (modèles non facturables par nature)', () => {
  test('<synthetic> : 0 $ délibéré, prix CONNU', () => {
    expect(computeCost({ input_tokens: 10, output_tokens: 5 }, '<synthetic>')).toEqual({
      usd: 0,
      known: true,
      model: '<synthetic>',
    });
  });

  test('ministral-3:latest : modèle local Ollama, 0 $ API délibéré', () => {
    expect(computeCost({ input_tokens: 1000, output_tokens: 500 }, 'ministral-3:latest')).toEqual({
      usd: 0,
      known: true,
      model: 'ministral-3:latest',
    });
  });

  test('le garde-fou tient : un modèle hors liste reste inconnu (coût null)', () => {
    expect(computeCost({ input_tokens: 10 }, 'claude-futur-9')).toEqual({
      usd: null,
      known: false,
      model: 'claude-futur-9',
    });
  });
});

describe('pricingKindOf — la contrepartie qualitative de computeCost', () => {
  test('tarifé / zéro voulu / inconnu', () => {
    expect(pricingKindOf('claude-opus-4-8')).toBe('tarife');
    expect(pricingKindOf('claude-sonnet-5', '2026-08-15T00:00:00.000Z')).toBe('tarife');
    expect(pricingKindOf('<synthetic>')).toBe('zero-voulu');
    expect(pricingKindOf('ministral-3:latest')).toBe('zero-voulu');
    expect(pricingKindOf('claude-futur-9')).toBe('inconnu');
    expect(pricingKindOf(null)).toBe('inconnu');
  });

  test("la normalisation s'applique comme dans computeCost", () => {
    expect(pricingKindOf('anthropic/claude-opus-4-8')).toBe('tarife');
    expect(pricingKindOf('claude-fable-5[1m]')).toBe('tarife');
  });
});

describe('priceTable — le barème réellement appliqué, exposé', () => {
  test('source, unité, et les 11 modèles de la table courante', () => {
    const t = priceTable();
    expect(t.source).toBe('netgain-table-embarquee');
    expect(t.unit).toBe('usd-par-jeton');
    expect(t.entries.map((e) => e.model).sort()).toEqual([
      'claude-fable-5', 'claude-haiku-4-5', 'claude-mythos-5', 'claude-opus-4-5',
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
});

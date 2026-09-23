// Un changement de tarif adopté, FICTIF : Sonnet 5 passerait de 2/10 à 3/15 $ le MTok.
// Les tests qui prouvent qu'un message est chiffré au tarif en vigueur à SA date
// s'appuient dessus ; la table embarquée, elle, n'a aucune période datée.
import { createPricing } from '../../src/engine/core/pricing.ts';
import type { AdoptedPrices } from '../../src/engine/core/pricing.ts';

export const HAUSSE_SONNET_5: AdoptedPrices = {
  'claude-sonnet-5': [{
    prices: { input: 3e-6, output: 1.5e-5, cacheCreate: 3.75e-6, cacheRead: 3e-7 },
    maxInput: 1_000_000,
    from: '2026-09-01T00:00:00.000Z',
    replaces: { input: 2e-6, output: 1e-5, cacheCreate: 2.5e-6, cacheRead: 2e-7 },
    adoptedAt: '2026-09-01T00:00:00.000Z',
    source: 'anthropic',
  }],
};

export const pricingAvecHausse = createPricing(HAUSSE_SONNET_5);

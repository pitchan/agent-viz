// Le panneau Tarifs lit les mises à jour LiteLLM en cours, et peut demander un
// passage de la vigie sur-le-champ plutôt qu'attendre le suivant.
import { expect, test } from 'vitest';
import { createObservatoryService } from '../../src/server/observatory/service.ts';
import type { Store } from '../../src/server/observatory/store.ts';
import type { Engine } from '../../src/server/observatory/engine.ts';
import type { KnownDrift } from '../../src/server/pricing.ts';

const DRIFT: KnownDrift = {
  model: 'claude-opus-5-5', kind: 'modele-nouveau', embedded: null, maxInput: 1_000_000,
  litellm: { input: 4e-6, output: 2e-5, cacheCreate: 5e-6, cacheRead: 2e-7 }, firstSeenAt: '2026-09-23T00:00:00.000Z',
};

function makeService(reachable: boolean) {
  const calls: string[] = [];
  const service = createObservatoryService({
    store: { getScanState: () => null } as unknown as Store,
    engine: {
      priceTable: () => ({ source: 'netgain-table-embarquee', unit: 'usd-par-jeton', entries: [], zeroCost: [] }),
      version: '0.40.0',
    } as unknown as Engine,
    collectConfig: async () => [],
    broadcast: () => {},
    now: () => new Date('2026-09-23T12:00:00.000Z'),
    adoptPrice: async () => null,
    vigie: {
      snapshot: () => ({ checkedAt: '2026-09-23T12:00:00.000Z', drifts: [DRIFT] }),
      refresh: async () => { calls.push('refresh'); return reachable; },
    },
    claudeDir: 'C:/x', sinceDays: 30, scanSinceDays: 90,
  });
  return { service, calls };
}

test('pricing() porte les mises à jour LiteLLM en cours', async () => {
  // Arrange
  const { service } = makeService(true);

  // Act
  const r = await service.pricing();

  // Assert
  expect(r.updates).toEqual({ checkedAt: '2026-09-23T12:00:00.000Z', drifts: [DRIFT] });
});

test('vérifier maintenant fait passer la vigie puis rend ce qu’elle a vu', async () => {
  // Arrange
  const { service, calls } = makeService(true);

  // Act
  const r = await service.checkPrices();

  // Assert
  expect(calls).toEqual(['refresh']);
  expect(r).toMatchObject({ reachable: true, drifts: [DRIFT] });
});

test('LiteLLM injoignable se dit, sans masquer les dérives déjà connues', async () => {
  // Arrange
  const { service } = makeService(false);

  // Act
  const r = await service.checkPrices();

  // Assert
  expect(r).toMatchObject({ reachable: false, drifts: [DRIFT] });
});

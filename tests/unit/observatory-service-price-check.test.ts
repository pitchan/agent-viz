// Le panneau Tarifs lit les mises à jour des tarifs en cours, et peut demander un
// passage de la vigie sur-le-champ plutôt qu'attendre le suivant.
import { expect, test } from 'vitest';
import { createObservatoryService } from '../../src/server/observatory/service.ts';
import type { Store } from '../../src/server/observatory/store.ts';
import type { Engine } from '../../src/server/observatory/engine.ts';
import type { KnownDrift } from '../../src/server/pricing.ts';
import { storedRowUsing } from '../helpers/observatory-fakes.ts';

const DRIFT: KnownDrift = {
  model: 'claude-opus-5-5', kind: 'modele-nouveau', embedded: null, maxInput: 1_000_000,
  official: { input: 4e-6, output: 2e-5, cacheCreate: 5e-6, cacheRead: 2e-7 }, firstSeenAt: '2026-09-23T00:00:00.000Z',
};

const MYTHOS: KnownDrift = { ...DRIFT, model: 'claude-mythos-6' };

function makeService(failure: string | null) {
  const calls: string[] = [];
  const service = createObservatoryService({
    store: {
      getScanState: () => null,
      listSessions: () => [storedRowUsing('s1', ['claude-opus-5-5'])],
    } as unknown as Store,
    engine: {
      priceTable: () => ({ source: 'netgain-table-embarquee', unit: 'usd-par-jeton', entries: [], zeroCost: [] }),
      version: '0.40.0',
    } as unknown as Engine,
    collectConfig: async () => [],
    broadcast: () => {},
    now: () => new Date('2026-09-23T12:00:00.000Z'),
    adoptPrice: async () => { throw new Error('aucune adoption dans ce test'); },
    vigie: {
      snapshot: () => ({ checkedAt: '2026-09-23T12:00:00.000Z', drifts: [DRIFT, MYTHOS] }),
      refresh: async () => { calls.push('refresh'); return failure; },
    },
    claudeDir: 'C:/x', sinceDays: 30, scanSinceDays: 90,
  });
  return { service, calls };
}

test('pricing() ne porte que les mises à jour des modèles appelés dans les transcripts', async () => {
  // Arrange
  const { service } = makeService(null);

  // Act
  const r = await service.pricing();

  // Assert
  expect(r.updates).toEqual({ checkedAt: '2026-09-23T12:00:00.000Z', drifts: [DRIFT] });
});

test('vérifier maintenant fait passer la vigie puis rend ce qu’elle a vu', async () => {
  // Arrange
  const { service, calls } = makeService(null);

  // Act
  const r = await service.checkPrices();

  // Assert
  expect(calls).toEqual(['refresh']);
  expect(r).toMatchObject({ failure: null, drifts: [DRIFT, MYTHOS] });
});

test('un échec de la vigie se dit avec sa cause, sans masquer les dérives déjà connues', async () => {
  // Arrange
  const { service } = makeService('page des tarifs injoignable');

  // Act
  const r = await service.checkPrices();

  // Assert
  expect(r).toMatchObject({ failure: 'page des tarifs injoignable', drifts: [DRIFT, MYTHOS] });
});

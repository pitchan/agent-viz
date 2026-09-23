// Appliquer un tarif touche des coûts déjà rangés : après un passage de la vigie, le
// service relit les sessions dont le coût change, et prévient les onglets.
import { expect, test } from 'vitest';
import { createObservatoryService } from '../../src/server/observatory/service.ts';
import type { Store } from '../../src/server/observatory/store.ts';
import type { Engine } from '../../src/server/observatory/engine.ts';
import type { Adopted, ApplicableDrift } from '../../src/server/price-adoption.ts';
import type { KnownDrift } from '../../src/server/pricing.ts';
import { fakeReport, fakeRef, storedRowUsing } from '../helpers/observatory-fakes.ts';

const P = { input: 4e-6, output: 2e-5, cacheCreate: 5e-6, cacheRead: 2e-7 };
const ROWS = [
  { id: 'incomplete', costComplete: false, endedAt: '2026-09-10T00:00:00.000Z' },
  { id: 'avant', costComplete: true, endedAt: '2026-09-19T00:00:00.000Z' },
  { id: 'apres', costComplete: true, endedAt: '2026-09-21T00:00:00.000Z' },
];

const drift = (over: Partial<KnownDrift> = {}): KnownDrift => ({
  model: 'claude-opus-6', kind: 'modele-nouveau', official: P, embedded: null,
  maxInput: 1_000_000, firstSeenAt: '2026-09-20T00:00:00.000Z', ...over,
});

// Les modèles que les transcripts scannés appellent.
const VUS = ['claude-opus-6', 'claude-opus-5', 'claude-sonnet-6'];

function harness(drifts: KnownDrift[], adopt: (drift: ApplicableDrift) => Promise<Adopted>) {
  const scanned: string[] = [];
  const messages: unknown[] = [];
  const store = {
    // Le filtre d'adoption lit toutes les lignes ; la liste des modèles appelés, la fenêtre
    // scannée sans filtre de nature ; le calcul des conseils, une fenêtre vide.
    listSessions: (o: { since?: string; kinds?: string[] }) => {
      if (o.since === undefined) return ROWS;
      return o.kinds === undefined ? [storedRowUsing('vus', VUS)] : [];
    },
    listConfigItems: () => [], replaceConfigItems: () => {}, upsertRecommendations: () => {},
    getScanState: () => null, setScanState: () => {}, needsScan: () => false, upsertSession: () => {},
  } as unknown as Store;
  const engine = {
    discoverSessions: async () => ROWS.map(r => fakeRef(r.id)),
    scanSession: async (ref: { sessionId: string }) => { scanned.push(ref.sessionId); return fakeReport(ref.sessionId); },
  } as unknown as Engine;
  const service = createObservatoryService({
    engine, store,
    collectConfig: async () => [],
    broadcast: m => { messages.push(m); },
    adoptPrice: adopt,
    vigie: { snapshot: () => ({ checkedAt: '2026-09-23T12:00:00.000Z', drifts }), refresh: async () => null },
    now: () => new Date('2026-09-23T12:00:00.000Z'),
    claudeDir: 'C:\\x\\.claude', sinceDays: 30, scanSinceDays: 90,
  });
  return { service, scanned, messages };
}

test('un modèle nouveau appliqué fait relire les sessions au coût incomplet', async () => {
  // Arrange
  const h = harness([drift()], async d => ({ model: d.model, kind: 'modele-nouveau', from: null, prices: P }));

  // Act
  await h.service.checkPrices();

  // Assert
  expect(h.scanned).toEqual(['incomplete']);
});

test('un tarif changé appliqué fait aussi relire les sessions finies après `from`', async () => {
  // Arrange
  const h = harness([drift({ model: 'claude-opus-5', kind: 'tarif-different' })],
    async d => ({ model: d.model, kind: 'tarif-different', from: '2026-09-20T00:00:00.000Z', prices: P }));

  // Act
  await h.service.checkPrices();

  // Assert
  expect(h.scanned.sort()).toEqual(['apres', 'incomplete']);
});

test('un tarif appliqué est diffusé aux onglets, avec ses prix', async () => {
  // Arrange
  const h = harness([drift()], async d => ({ model: d.model, kind: 'modele-nouveau', from: null, prices: P }));

  // Act
  await h.service.checkPrices();

  // Assert
  expect(h.messages).toContainEqual({ type: 'pricingAdopted', model: 'claude-opus-6', kind: 'modele-nouveau', prices: P });
});

test('un tarif appliqué à un modèle qu’aucun transcript n’appelle n’est pas diffusé', async () => {
  // Arrange
  const h = harness([drift({ model: 'claude-mythos-6' })], async d => ({ model: d.model, kind: 'modele-nouveau', from: null, prices: P }));

  // Act
  const r = await h.service.checkPrices();

  // Assert
  expect(r.adopted.map(a => a.model)).toEqual(['claude-mythos-6']);
  expect(h.messages.filter(m => (m as { type: string }).type === 'pricingAdopted')).toEqual([]);
});

test('un modèle à la fenêtre de contexte inconnue n’est pas tenté', async () => {
  // Arrange
  const tentes: string[] = [];
  const h = harness([drift({ maxInput: null })], async d => { tentes.push(d.model); return { model: d.model, kind: d.kind, from: null, prices: P }; });

  // Act
  await h.service.checkPrices();

  // Assert
  expect(tentes).toEqual([]);
});

test('une adoption qui échoue est rendue avec sa cause, les autres continuent', async () => {
  // Arrange
  const h = harness([drift({ model: 'claude-opus-6' }), drift({ model: 'claude-sonnet-6' })], async d => {
    if (d.model === 'claude-opus-6') throw new Error('disque plein');
    return { model: d.model, kind: 'modele-nouveau', from: null, prices: P };
  });

  // Act
  const r = await h.service.checkPrices();

  // Assert
  expect(r.errors).toEqual([{ model: 'claude-opus-6', message: 'disque plein' }]);
  expect(r.adopted.map(a => a.model)).toEqual(['claude-sonnet-6']);
});

test('deux vérifications demandées ensemble passent l’une après l’autre', async () => {
  // Arrange
  const journal: string[] = [];
  const h = harness([drift()], async d => {
    journal.push('debut');
    await new Promise(r => setImmediate(r));
    journal.push('fin');
    return { model: d.model, kind: 'modele-nouveau', from: null, prices: P };
  });

  // Act
  await Promise.all([h.service.checkPrices(), h.service.checkPrices()]);

  // Assert
  expect(journal).toEqual(['debut', 'fin', 'debut', 'fin']);
});

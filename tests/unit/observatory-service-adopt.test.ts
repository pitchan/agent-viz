// Adopter un prix touche des coûts déjà rangés : le service relit les sessions dont
// le coût change, et prévient les onglets.
import { expect, test } from 'vitest';
import { createObservatoryService } from '../../src/server/observatory/service.ts';
import type { Store } from '../../src/server/observatory/store.ts';
import type { Engine } from '../../src/server/observatory/engine.ts';
import type { Adopted } from '../../src/server/price-adoption.ts';
import { fakeReport, fakeRef } from '../helpers/observatory-fakes.ts';

const ROWS = [
  { id: 'incomplete', costComplete: false, endedAt: '2026-09-10T00:00:00.000Z' },
  { id: 'avant', costComplete: true, endedAt: '2026-09-19T00:00:00.000Z' },
  { id: 'apres', costComplete: true, endedAt: '2026-09-21T00:00:00.000Z' },
];

function harness(adopted: Adopted | null) {
  const scanned: string[] = [];
  const messages: unknown[] = [];
  const store = {
    // Le filtre d'adoption lit toutes les lignes ; le calcul des conseils, une fenêtre vide.
    listSessions: (o: { since?: string }) => (o.since === undefined ? ROWS : []),
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
    adoptPrice: async () => adopted,
    now: () => new Date('2026-09-23T12:00:00.000Z'),
    claudeDir: 'C:\\x\\.claude', sinceDays: 30, scanSinceDays: 90,
  });
  return { service, scanned, messages };
}

test('adopter un modèle nouveau relit les sessions au coût incomplet', async () => {
  // Arrange
  const h = harness({ model: 'claude-opus-5-5', kind: 'modele-nouveau', from: null });

  // Act
  await h.service.adoptPrice('claude-opus-5-5');

  // Assert
  expect(h.scanned).toEqual(['incomplete']);
});

test('adopter un tarif différent relit aussi les sessions finies après `from`', async () => {
  // Arrange
  const h = harness({ model: 'claude-opus-5', kind: 'tarif-different', from: '2026-09-20T00:00:00.000Z' });

  // Act
  await h.service.adoptPrice('claude-opus-5');

  // Assert
  expect(h.scanned.sort()).toEqual(['apres', 'incomplete']);
});

test('adopter diffuse pricingAdopted avec le modèle', async () => {
  // Arrange
  const h = harness({ model: 'claude-opus-5-5', kind: 'modele-nouveau', from: null });

  // Act
  await h.service.adoptPrice('claude-opus-5-5');

  // Assert
  expect(h.messages).toContainEqual({ type: 'pricingAdopted', model: 'claude-opus-5-5' });
});

test('un modèle sans dérive rend null, ne relit rien, ne diffuse rien', async () => {
  // Arrange
  const h = harness(null);

  // Act
  const r = await h.service.adoptPrice('claude-opus-5-5');

  // Assert
  expect(r).toBeNull();
  expect(h.scanned).toEqual([]);
  expect(h.messages).toEqual([]);
});

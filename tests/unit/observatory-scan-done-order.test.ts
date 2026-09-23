// The 'done' broadcast is the client's reload signal: it must fire only after
// the recomputed advice is stored, or a post-purge reload reads a still-empty
// recommendations table.

import { expect, test } from 'vitest';
import { createObservatoryService } from '../../src/server/observatory/service.ts';
import type { Store } from '../../src/server/observatory/store.ts';
import type { Engine } from '../../src/server/observatory/engine.ts';

test("scan broadcasts 'done' only after recommendations are stored", async () => {
  const sequence: string[] = [];
  const store = {
    listSessions: () => [],
    listConfigItems: () => [],
    replaceConfigItems: () => {},
    upsertRecommendations: () => { sequence.push('upsert-recommendations'); },
    getScanState: () => null,
    setScanState: () => {},
    needsScan: () => false,
  } as unknown as Store;
  const engine = {
    discoverSessions: async () => [],
    scanSession: async () => { throw new Error('not reached: no session to scan'); },
  } as unknown as Engine;
  const service = createObservatoryService({
    engine, store,
    collectConfig: async () => [],
    broadcast: m => sequence.push(`broadcast-${'phase' in m ? m.phase : m.type}`),
    now: () => new Date('2026-08-04T10:00:00.000Z'),
    adoptPrice: async () => null,
    vigie: { snapshot: () => ({ checkedAt: null, drifts: [] }), refresh: async () => true },
    claudeDir: 'C:\\x\\.claude', sinceDays: 30, scanSinceDays: 90,
  });

  await service.scan({});

  const done = sequence.indexOf('broadcast-done');
  const upsert = sequence.indexOf('upsert-recommendations');
  expect(done, "the scan must still broadcast 'done'").not.toBe(-1);
  expect(upsert, 'the scan must still store recommendations').not.toBe(-1);
  expect(upsert < done, `'done' must come after the advice write, got: ${sequence.join(' -> ')}`).toBeTruthy();
});

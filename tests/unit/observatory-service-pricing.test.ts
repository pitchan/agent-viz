// The two pricing-panel service methods: window clamping for modelCosts, and
// the window-independent pricing() payload. Deps are injected — no SQLite, no
// real engine.

import { expect, test } from 'vitest';
import { createObservatoryService } from '../../src/server/observatory/service.ts';
import { SCAN_VERSION } from '../../src/server/observatory/scan-version.ts';
import type { Store } from '../../src/server/observatory/store.ts';
import type { Engine } from '../../src/server/observatory/engine.ts';
import type { PriceTableEntry } from '../../src/engine/core/pricing.ts';
import { storedRowUsing } from '../helpers/observatory-fakes.ts';

const entry = (model: string) => ({ model } as PriceTableEntry);

function makeService(listed: any[], rows: unknown[] = []) {
  return createObservatoryService({
    store: {
      listSessions: (q: any) => { listed.push(q); return q.kinds === undefined ? rows : []; },
      countByKind: () => ({ interactive: 0, headless: 0, unknown: 0 }),
      getScanState: () => null,
    } as unknown as Store,
    engine: {
      priceTable: () => ({
        source: 'netgain-table-embarquee', unit: 'usd-par-jeton',
        entries: [entry('claude-opus-5-5'), entry('claude-mythos-5-1')],
        zeroCost: [{ model: '<synthetic>', reason: 'r' }, { model: 'ministral-3:latest', reason: 'r' }],
      }),
      version: '0.13.0',
    } as unknown as Engine,
    collectConfig: async () => [],
    broadcast: () => {},
    now: () => new Date('2026-08-05T12:00:00.000Z'),
    adoptPrice: async () => { throw new Error('aucune adoption dans ce test'); },
    vigie: { snapshot: () => ({ checkedAt: null, drifts: [] }), refresh: async () => null },
    claudeDir: 'C:/x', sinceDays: 30, scanSinceDays: 90,
  });
}

test('modelCosts clamps the window and reads human sessions by default', async () => {
  const listed: any[] = [];
  const r = await makeService(listed).modelCosts({ days: 12345 });
  expect(listed[0].kinds).toEqual(['interactive']);
  // 12345 is not in the 7/30/90 table → default 30-day window.
  expect(listed[0].since).toBe('2026-07-06T12:00:00.000Z');
  expect(r.period.days).toBe(30);
  expect(r.basis.includeMachine).toBe(false);
});

test('pricing() returns the engine table, the provenance and the versions', async () => {
  const p = await makeService([]).pricing();
  expect(p.priceTable.source).toBe('netgain-table-embarquee');
  expect(p.engineVersion).toBe('0.13.0');
  expect(p.scanVersion).toBe(SCAN_VERSION);
  expect(p.provenance.sections.length).toBe(8);
  expect(p.provenance.engineVersion).toBe('0.13.0');
});

test('pricing() ne montre que les tarifs des modèles appelés dans les transcripts', async () => {
  // Arrange
  const rows = [storedRowUsing('s1', ['claude-opus-5-5']), storedRowUsing('s2', ['<synthetic>'])];

  // Act
  const p = await makeService([], rows).pricing();

  // Assert
  expect(p.priceTable.entries.map(e => e.model)).toEqual(['claude-opus-5-5']);
  expect(p.priceTable.zeroCost.map(z => z.model)).toEqual(['<synthetic>']);
});

test('pricing() lit les modèles sur toute la fenêtre scannée, sessions machine comprises', async () => {
  // Arrange
  const listed: any[] = [];

  // Act
  await makeService(listed).pricing();

  // Assert
  expect(listed).toEqual([{ since: '2026-05-07T12:00:00.000Z' }]);
});

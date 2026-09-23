// The two pricing-panel service methods: window clamping for modelCosts, and
// the window-independent pricing() payload. Deps are injected — no SQLite, no
// real engine.

import { expect, test } from 'vitest';
import { createObservatoryService } from '../../src/server/observatory/service.ts';
import { SCAN_VERSION } from '../../src/server/observatory/scan-version.ts';
import type { Store } from '../../src/server/observatory/store.ts';
import type { Engine } from '../../src/server/observatory/engine.ts';

function makeService(listed: any[]) {
  return createObservatoryService({
    store: {
      listSessions: (q: any) => { listed.push(q); return []; },
      countByKind: () => ({ interactive: 0, headless: 0, unknown: 0 }),
      getScanState: () => null,
    } as unknown as Store,
    engine: {
      priceTable: () => ({ source: 'netgain-table-embarquee', unit: 'usd-par-jeton', entries: [], zeroCost: [] }),
      version: '0.13.0',
    } as unknown as Engine,
    collectConfig: async () => [],
    broadcast: () => {},
    now: () => new Date('2026-08-05T12:00:00.000Z'),
    adoptPrice: async () => null,
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

'use strict';
// The two pricing-panel service methods: window clamping for modelCosts, and
// the window-independent pricing() payload. Deps are injected — no SQLite, no
// real engine.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createObservatoryService } = require('../../src/server/observatory/service.ts');
const { SCAN_VERSION } = require('../../src/server/observatory/scan-version.ts');

function makeService(listed) {
  return createObservatoryService({
    store: {
      listSessions: q => { listed.push(q); return []; },
      countByKind: () => ({ interactive: 0, headless: 0, unknown: 0 }),
      getScanState: () => null,
    },
    loadEngine: async () => ({
      priceTable: () => ({ source: 'netgain-table-embarquee', unit: 'usd-par-jeton', entries: [], zeroCost: [] }),
      version: '0.13.0',
    }),
    collectConfig: async () => [],
    broadcast: () => {},
    now: () => new Date('2026-08-05T12:00:00.000Z'),
    claudeDir: 'C:/x', sinceDays: 30, scanSinceDays: 90,
  });
}

test('modelCosts clamps the window and reads human sessions by default', async () => {
  const listed = [];
  const r = await makeService(listed).modelCosts({ days: 12345 });
  assert.deepEqual(listed[0].kinds, ['interactive']);
  // 12345 is not in the 7/30/90 table → default 30-day window.
  assert.equal(listed[0].since, '2026-07-06T12:00:00.000Z');
  assert.equal(r.period.days, 30);
  assert.equal(r.basis.includeMachine, false);
});

test('pricing() returns the engine table, the provenance and the versions', async () => {
  const p = await makeService([]).pricing();
  assert.equal(p.priceTable.source, 'netgain-table-embarquee');
  assert.equal(p.engineVersion, '0.13.0');
  assert.equal(p.scanVersion, SCAN_VERSION);
  assert.equal(p.provenance.sections.length, 8);
  assert.equal(p.provenance.engineVersion, '0.13.0');
});

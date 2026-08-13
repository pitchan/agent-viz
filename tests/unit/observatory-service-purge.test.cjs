'use strict';
// service.purge: the wipe is guarded by the engine check — a base the engine
// cannot rebuild must never be wiped.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createObservatoryService } = require('../../src/server/observatory/service.ts');

test('purge refuses to wipe when the engine is missing', async () => {
  let purged = false;
  const service = createObservatoryService({
    store: { purge: () => { purged = true; } },
    loadEngine: async () => { throw new Error('netgain introuvable'); },
  });
  await assert.rejects(service.purge(), err => err.engineMissing === true);
  assert.equal(purged, false);
});

test('purge wipes the store once the engine is confirmed present', async () => {
  let purged = false;
  const service = createObservatoryService({
    store: { purge: () => { purged = true; } },
    loadEngine: async () => ({}),
  });
  await service.purge();
  assert.equal(purged, true);
});

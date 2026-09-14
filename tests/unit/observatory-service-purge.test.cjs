'use strict';
// service.purge empties the store and does nothing else: the engine is built
// when its module loads, so no engine check stands before the wipe.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createObservatoryService } = require('../../src/server/observatory/service.ts');

test('purge empties the store', async () => {
  let purged = false;
  const service = createObservatoryService({
    store: { purge: () => { purged = true; } },
  });
  await service.purge();
  assert.equal(purged, true);
});

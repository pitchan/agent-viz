'use strict';
// The 'done' broadcast is the client's reload signal: it must fire only after
// the recomputed advice is stored, or a post-purge reload reads a still-empty
// recommendations table (bug seen live on 2026-08-04).

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createObservatoryService } = require('../../lib/server/observatory/service');

test("scan broadcasts 'done' only after recommendations are stored", async () => {
  const sequence = [];
  const store = {
    listSessions: () => [],
    listConfigItems: () => [],
    replaceConfigItems: () => {},
    upsertRecommendations: () => { sequence.push('upsert-recommendations'); },
    getScanState: () => null,
    setScanState: () => {},
    needsScan: () => false,
  };
  const engine = {
    discoverSessions: async () => [],
    scanSession: async () => { throw new Error('not reached: no session to scan'); },
  };
  const service = createObservatoryService({
    loadEngine: async () => engine, store,
    collectConfig: async () => [],
    broadcast: m => sequence.push(`broadcast-${m.phase}`),
    now: () => new Date('2026-08-04T10:00:00.000Z'),
    claudeDir: 'C:\\x\\.claude', sinceDays: 30, scanSinceDays: 90,
  });

  await service.scan({});

  const done = sequence.indexOf('broadcast-done');
  const upsert = sequence.indexOf('upsert-recommendations');
  assert.notEqual(done, -1, "the scan must still broadcast 'done'");
  assert.notEqual(upsert, -1, 'the scan must still store recommendations');
  assert.ok(upsert < done,
    `'done' must come after the advice write, got: ${sequence.join(' -> ')}`);
});

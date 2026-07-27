'use strict';
// SQLite store: schema, round-trips, the incremental-scan key and freshness.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { openStore } = require('../../lib/server/observatory/store');
const { SCAN_VERSION } = require('../../lib/server/observatory/scan-version');

function tmpStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'obs-store-'));
  return { store: openStore(path.join(dir, 'nested', 'observatory.db')), dir };
}
const cleanup = h => { h.store.close(); fs.rmSync(h.dir, { recursive: true, force: true }); };

const ROW = {
  id: 'sess-1', project: 'F--proj', transcriptPath: 'F:\\p\\sess-1.jsonl',
  fileMtime: 1000, fileSize: 2048, scanVersion: SCAN_VERSION,
  startedAt: '2026-07-01T10:00:00.000Z', endedAt: '2026-07-01T10:30:00.000Z',
  modelMain: 'claude-opus-4-8', netTokens: 5000, costUsd: 0.42, costComplete: true,
  reportJson: '{"sessionId":"sess-1"}',
};

test('openStore creates missing parent directories and a usable schema', () => {
  const h = tmpStore();
  try {
    assert.deepEqual(h.store.listSessions({}), []);
    assert.deepEqual(h.store.listConfigItems(), []);
    assert.deepEqual(h.store.listRecommendations({}), []);
  } finally { cleanup(h); }
});

test('upsertSession round-trips every column, costComplete stays boolean', () => {
  const h = tmpStore();
  try {
    h.store.upsertSession(ROW);
    assert.deepEqual(h.store.getSession('sess-1'), ROW);
  } finally { cleanup(h); }
});

test('upsertSession is idempotent — same id updates, never duplicates', () => {
  const h = tmpStore();
  try {
    h.store.upsertSession(ROW);
    h.store.upsertSession({ ...ROW, netTokens: 9999 });
    assert.equal(h.store.listSessions({}).length, 1);
    assert.equal(h.store.getSession('sess-1').netTokens, 9999);
  } finally { cleanup(h); }
});

test('needsScan: unchanged path+mtime+size+scanVersion means skip', () => {
  const h = tmpStore();
  try {
    const ref = { sessionId: 'sess-1', mainPath: ROW.transcriptPath, mtime: new Date(1000), sizeBytes: 2048 };
    assert.equal(h.store.needsScan(ref, SCAN_VERSION), true, 'unknown session must be scanned');
    h.store.upsertSession(ROW);
    assert.equal(h.store.needsScan(ref, SCAN_VERSION), false, 'unchanged session must be skipped');
    assert.equal(h.store.needsScan({ ...ref, mtime: new Date(2000) }, SCAN_VERSION), true, 'newer mtime rescans');
    assert.equal(h.store.needsScan({ ...ref, sizeBytes: 4096 }, SCAN_VERSION), true, 'new size rescans');
    assert.equal(h.store.needsScan({ ...ref, mainPath: 'F:\\other.jsonl' }, SCAN_VERSION), true, 'moved file rescans');
    assert.equal(h.store.needsScan(ref, SCAN_VERSION + 1), true, 'bumped scan version rescans everything');
  } finally { cleanup(h); }
});

test('listSessions filters by project and by since, newest first', () => {
  const h = tmpStore();
  try {
    h.store.upsertSession(ROW);
    h.store.upsertSession({ ...ROW, id: 'sess-2', project: 'F--other', startedAt: '2026-07-10T10:00:00.000Z' });
    assert.deepEqual(h.store.listSessions({ project: 'F--other' }).map(s => s.id), ['sess-2']);
    assert.deepEqual(h.store.listSessions({ since: '2026-07-05T00:00:00.000Z' }).map(s => s.id), ['sess-2']);
    assert.deepEqual(h.store.listSessions({}).map(s => s.id), ['sess-2', 'sess-1']);
  } finally { cleanup(h); }
});

test('replaceConfigItems swaps the whole inventory in one shot', () => {
  const h = tmpStore();
  try {
    h.store.replaceConfigItems('2026-07-01T00:00:00.000Z', [
      { kind: 'mcp', name: 'mdb-explorer', scope: 'user', detail: { toolCount: 9 } },
    ]);
    h.store.replaceConfigItems('2026-07-02T00:00:00.000Z', [
      { kind: 'skill', name: 'pdf', scope: 'user', detail: { bytes: 1200 } },
    ]);
    assert.deepEqual(h.store.listConfigItems(),
      [{ kind: 'skill', name: 'pdf', scope: 'user', detail: { bytes: 1200 } }]);
  } finally { cleanup(h); }
});

const REC = {
  ruleId: 'R3', subject: 'Bash:npm test', title: 'Sortie volumineuse répétée',
  category: 'outils', confidence: 'fait', estimatedCostUsd: 1.25,
  costBasis: 'octets-approx-4o-par-jeton', evidence: { sessions: ['sess-1'], bytes: 900000 },
  action: 'Cibler la commande',
};

test('upsertRecommendations keeps identity on (ruleId, subject) and preserves status', () => {
  const h = tmpStore();
  try {
    h.store.upsertRecommendations([REC], '2026-07-01T00:00:00.000Z');
    const [first] = h.store.listRecommendations({});
    assert.equal(first.status, 'new');
    assert.equal(first.estimatedCostUsd, 1.25);
    assert.equal(first.costAtStatusUsd, null);
    assert.equal(first.lastSeenAt, '2026-07-01T00:00:00.000Z');

    assert.equal(h.store.setRecommendationStatus(first.id, 'ignored', '2026-07-02T00:00:00.000Z'), true);
    assert.equal(h.store.listRecommendations({ status: 'ignored' })[0].costAtStatusUsd, 1.25,
      'cost is frozen at decision time');

    h.store.upsertRecommendations([{ ...REC, estimatedCostUsd: 3 }], '2026-07-03T00:00:00.000Z');
    const all = h.store.listRecommendations({});
    assert.equal(all.length, 1, 'same rule+subject must not duplicate');
    assert.equal(all[0].status, 'ignored', 'a rescan never resurrects a decision');
    assert.equal(all[0].estimatedCostUsd, 3, 'but the cost is refreshed');
    assert.equal(all[0].costAtStatusUsd, 1.25);
    assert.equal(all[0].lastSeenAt, '2026-07-03T00:00:00.000Z', 'freshness moves forward');
  } finally { cleanup(h); }
});

test('a recommendation the latest scan did not re-emit keeps its older lastSeenAt', () => {
  const h = tmpStore();
  try {
    h.store.upsertRecommendations([REC, { ...REC, subject: 'Bash:ls' }], '2026-07-01T00:00:00.000Z');
    h.store.upsertRecommendations([REC], '2026-07-05T00:00:00.000Z');
    const seen = Object.fromEntries(h.store.listRecommendations({}).map(r => [r.subject, r.lastSeenAt]));
    assert.equal(seen['Bash:npm test'], '2026-07-05T00:00:00.000Z');
    assert.equal(seen['Bash:ls'], '2026-07-01T00:00:00.000Z', 'stale rows keep their old date, they are not deleted');
  } finally { cleanup(h); }
});

test('setRecommendationStatus returns false for an unknown id', () => {
  const h = tmpStore();
  try {
    assert.equal(h.store.setRecommendationStatus(999, 'accepted', '2026-07-02T00:00:00.000Z'), false);
  } finally { cleanup(h); }
});

test('scan state round-trips per claude dir', () => {
  const h = tmpStore();
  try {
    assert.equal(h.store.getScanState('C:\\Users\\x\\.claude'), null);
    h.store.setScanState('C:\\Users\\x\\.claude', '2026-07-01T00:00:00.000Z', '0.11.0');
    assert.deepEqual(h.store.getScanState('C:\\Users\\x\\.claude'),
      { lastScanAt: '2026-07-01T00:00:00.000Z', engineVersion: '0.11.0' });
  } finally { cleanup(h); }
});

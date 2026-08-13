'use strict';
// Incremental scan orchestration. The engine, the clock and the SSE transport
// are injected, so this runs without netgain and without files.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { runIncrementalScan } = require('../../src/server/observatory/scan');
const { openStore } = require('../../src/server/observatory/store');
const { SCAN_VERSION } = require('../../src/server/observatory/scan-version');

function fakeReport(id, over = {}) {
  return {
    sessionId: id, projectSlug: 'F--proj', cwd: 'F:\\proj',
    startedAt: '2026-07-01T10:00:00.000Z', endedAt: '2026-07-01T10:20:00.000Z',
    sessionKind: 'interactive',
    tokens: { perModel: { 'claude-opus-4-8': { in: 100, out: 50, cacheCreate: 850, cacheRead: 4000 } },
      costUsd: 0.5, costComplete: true },
    netTokens: 1000, events: 10, parseErrors: 0,
    ...over,
  };
}
const fakeRef = (id, { mtime = 1000, size = 2048 } = {}) => ({
  sessionId: id, projectSlug: 'F--proj', mainPath: `F:\\p\\${id}.jsonl`,
  subagents: [], mtime: new Date(mtime), sizeBytes: size });

function harness(refs, scan) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'obs-scan-'));
  const messages = [];
  const store = openStore(path.join(dir, 'observatory.db'));
  return {
    dir, messages, store,
    deps: {
      engine: { discoverSessions: async () => refs, scanSession: scan },
      store,
      broadcast: m => messages.push(m),
      now: () => new Date('2026-07-15T12:00:00.000Z'),
    },
  };
}
const cleanup = h => { h.store.close(); fs.rmSync(h.dir, { recursive: true, force: true }); };
const OPTS = { claudeDir: 'C:\\x\\.claude', sinceDays: 30 };

test('first run scans every discovered session and stores one row each', async () => {
  const h = harness([fakeRef('s1'), fakeRef('s2')], async ref => fakeReport(ref.sessionId));
  try {
    const out = await runIncrementalScan(h.deps, OPTS);
    assert.deepEqual(
      { discovered: out.discovered, scanned: out.scanned, skipped: out.skipped, failed: out.failed },
      { discovered: 2, scanned: 2, skipped: 0, failed: 0 });
    assert.equal(h.store.listSessions({}).length, 2);
    assert.equal(h.store.getSession('s1').modelMain, 'claude-opus-4-8');
    assert.equal(h.store.getSession('s1').scanVersion, SCAN_VERSION);
  } finally { cleanup(h); }
});

test('second run with unchanged files skips everything', async () => {
  let calls = 0;
  const h = harness([fakeRef('s1')], async ref => { calls++; return fakeReport(ref.sessionId); });
  try {
    await runIncrementalScan(h.deps, OPTS);
    const out = await runIncrementalScan(h.deps, OPTS);
    assert.equal(calls, 1, 'scanSession must not be called again');
    assert.deepEqual({ scanned: out.scanned, skipped: out.skipped }, { scanned: 0, skipped: 1 });
  } finally { cleanup(h); }
});

test('a bumped scan version forces a full rescan', async () => {
  let calls = 0;
  const h = harness([fakeRef('s1')], async ref => { calls++; return fakeReport(ref.sessionId); });
  try {
    await runIncrementalScan(h.deps, OPTS);
    const out = await runIncrementalScan(h.deps, { ...OPTS, scanVersion: SCAN_VERSION + 1 });
    assert.equal(calls, 2);
    assert.equal(out.scanned, 1);
  } finally { cleanup(h); }
});

test('a session that throws is counted as failed and never stops the scan', async () => {
  const h = harness([fakeRef('bad'), fakeRef('good')], async ref => {
    if (ref.sessionId === 'bad') throw new Error('transcript illisible');
    return fakeReport(ref.sessionId);
  });
  try {
    const out = await runIncrementalScan(h.deps, OPTS);
    assert.deepEqual({ scanned: out.scanned, failed: out.failed }, { scanned: 1, failed: 1 });
    assert.deepEqual(h.store.listSessions({}).map(s => s.id), ['good']);
  } finally { cleanup(h); }
});

test('a report flagged skipped by the engine is counted, not stored as a free session', async () => {
  const h = harness([fakeRef('s1')],
    async ref => fakeReport(ref.sessionId, { skipped: 'transcript principal illisible' }));
  try {
    const out = await runIncrementalScan(h.deps, OPTS);
    assert.deepEqual({ scanned: out.scanned, failed: out.failed }, { scanned: 0, failed: 1 });
    assert.equal(h.store.listSessions({}).length, 0);
  } finally { cleanup(h); }
});

test("progress is broadcast as start then per-session progress — 'done' belongs to the service", async () => {
  // 'done' is the client's reload signal and must wait for the advice write,
  // so runIncrementalScan never emits it (see observatory-scan-done-order).
  const h = harness([fakeRef('s1'), fakeRef('s2')], async ref => fakeReport(ref.sessionId));
  try {
    await runIncrementalScan(h.deps, OPTS);
    assert.deepEqual(h.messages.map(m => m.phase), ['start', 'progress', 'progress']);
    assert.ok(h.messages.every(m => m.type === 'analysisScan'));
    assert.equal(h.messages[0].total, 2);
    assert.equal(h.messages.at(-1).scanned, 2);
  } finally { cleanup(h); }
});

test('the scan window is passed to the engine as a since date', async () => {
  let seen = null;
  const h = harness([], async () => fakeReport('none'));
  h.deps.engine.discoverSessions = async (_dir, filters) => { seen = filters.since; return []; };
  try {
    await runIncrementalScan(h.deps, OPTS);
    assert.equal(seen.toISOString(), '2026-06-15T12:00:00.000Z');
  } finally { cleanup(h); }
});

test('the scan state records when and with which scan version', async () => {
  const h = harness([], async () => fakeReport('none'));
  try {
    await runIncrementalScan(h.deps, OPTS);
    assert.deepEqual(h.store.getScanState('C:\\x\\.claude'),
      { lastScanAt: '2026-07-15T12:00:00.000Z', engineVersion: String(SCAN_VERSION) });
  } finally { cleanup(h); }
});

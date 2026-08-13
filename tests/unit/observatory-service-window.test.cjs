'use strict';
// The two structural M1.1 decisions, pinned: persistence always scans 90 days
// while advice reads the chosen window on the human basis only; every
// recommendation is stamped with the period it was observed on.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createObservatoryService, WINDOW_DAYS } = require('../../src/server/observatory/service');

const NOW = new Date('2026-08-03T12:00:00.000Z');
const daysAgo = n => new Date(NOW.getTime() - n * 24 * 3600 * 1000).toISOString();

// A stored row whose report makes R1 fire (prefixChange dominant, 40 % of net):
// with at least one recommendation emitted, the period-stamp assertions below
// are real, never vacuously true on an empty list. The quiet-zero fields keep
// the other five rules silent instead of throwing.
const stat = (events, tokens) => ({ events, tokens });
const R1_REPORT = {
  context: {
    churnCauses: {
      prefixChange: stat(1, 40000), compaction: stat(0, 0), expiration: stat(0, 0),
      growth: stat(0, 0), unknown: stat(0, 0),
    },
    prefixBreakdown: {
      markers: { modelSwitch: stat(0, 0), toolsAppeared: stat(0, 0), noMarker: stat(1, 40000) },
      noMarkerDetail: { earlyMcp: stat(0, 0), other: stat(1, 40000) },
      depth: { facade: stat(1, 40000), d10to50: stat(0, 0), d50to90: stat(0, 0), tail: stat(0, 0) },
    },
    compactions: [],
  },
  toolResults: { byTool: {}, totalBytes: 0, candidateFilters: [] },
  reads: { cases: { crossAgentDuplicate: { bytes: 0, count: 0 } }, totalBytes: 0 },
  subagents: { spawnToolUses: 0 },
  tokens: { perAgent: {}, perModel: {}, costUsd: 1, costComplete: true },
};
const HUMAN_ROW = {
  id: 'sess-h1', project: 'F--dvf', transcriptPath: 'F:\\x.jsonl',
  fileMtime: 0, fileSize: 1, scanVersion: 2,
  startedAt: daysAgo(2), endedAt: daysAgo(2), modelMain: 'claude-opus-4-8',
  netTokens: 100000, costUsd: 1, costComplete: true, sessionKind: 'interactive',
  reportJson: JSON.stringify(R1_REPORT),
};

// Real deps (service.js head): { store, loadEngine, collectConfig, broadcast,
// now, claudeDir, sinceDays, scanSinceDays } — the engine arrives through a
// loader function, not as a ready object, and config collection is a
// separate collaborator from the store.
function fakeDeps({ rows = [] } = {}) {
  const calls = { listSessions: [], discoverSince: null, upserted: null };
  const store = {
    listSessions: opts => { calls.listSessions.push(opts); return rows; },
    countByKind: () => ({ interactive: 2, headless: 5, unknown: 1 }),
    listConfigItems: () => [],
    replaceConfigItems: () => {},
    upsertRecommendations: recs => { calls.upserted = recs; },
    getScanState: () => null,
    setScanState: () => {},
    needsScan: () => false,
  };
  const engine = {
    discoverSessions: async (_dir, { since }) => { calls.discoverSince = since; return []; },
    parseSince: raw => new Date(raw),
    scanSession: async () => { throw new Error('not reached: no session to scan'); },
    netTokens: () => 0,
  };
  return { calls, store, engine };
}

function serviceOf(deps) {
  // Mirror the real composition (index.js): default advice window 30, scan window 90.
  return createObservatoryService({
    loadEngine: async () => deps.engine, store: deps.store,
    collectConfig: async () => [],
    broadcast: () => {}, now: () => NOW,
    claudeDir: 'C:\\Users\\x\\.claude', sinceDays: 30, scanSinceDays: 90,
  });
}

test('WINDOW_DAYS is the 7/30/90 spec table', () => {
  assert.deepEqual(WINDOW_DAYS, [7, 30, 90]);
});

test('summary defaults: 30-day window, human kinds only, basis passed through', async () => {
  const deps = fakeDeps();
  const out = await serviceOf(deps).summary();
  const q = deps.calls.listSessions[0];
  assert.deepEqual(q.kinds, ['interactive']);
  assert.equal(q.since, daysAgo(30));
  assert.deepEqual(out.basis.counts, { interactive: 2, headless: 5, unknown: 1 });
  assert.equal(out.basis.includeMachine, false);
  assert.deepEqual(out.period, { from: daysAgo(30), to: NOW.toISOString(), days: 30 });
});

test('summary({days: 7}) narrows the window; an off-table value falls back to the default', async () => {
  const deps = fakeDeps();
  await serviceOf(deps).summary({ days: 7 });
  assert.equal(deps.calls.listSessions[0].since, daysAgo(7));
  await serviceOf(fakeDeps()).summary({ days: 12 }).then(out =>
    assert.equal(out.period.days, 30, 'off-table windows are never honored silently'));
});

test('summary({includeMachine: true}) lifts the kind filter but still announces the basis', async () => {
  const deps = fakeDeps();
  const out = await serviceOf(deps).summary({ includeMachine: true });
  assert.equal(deps.calls.listSessions[0].kinds, undefined);
  assert.equal(out.basis.includeMachine, true);
});

test('scan persists 90 days but evaluates advice on the requested window, human only, and stamps the period', async () => {
  const deps = fakeDeps({ rows: [HUMAN_ROW] });
  await serviceOf(deps).scan({ days: 7 });
  assert.equal(deps.calls.discoverSince.toISOString(), daysAgo(90), 'persistence window never shrinks');
  const adviceQuery = deps.calls.listSessions.find(q => q.kinds);
  assert.deepEqual(adviceQuery.kinds, ['interactive']);
  assert.equal(adviceQuery.since, daysAgo(7));
  assert.ok(deps.calls.upserted.length >= 1, 'the R1 fixture must produce at least one recommendation');
  for (const rec of deps.calls.upserted) {
    assert.equal(rec.periodFrom, daysAgo(7));
    assert.equal(rec.periodTo, NOW.toISOString());
  }
});

// The project label is put on here and nowhere else: the rules only carry the
// slug as an identity. The service is therefore the seam that must be pinned.
test('scan names the project with the real working directory, keeping the slug as identity', async () => {
  const row = { ...HUMAN_ROW, reportJson: JSON.stringify({ ...R1_REPORT, cwd: 'd:\\dvf-postgis-pipeline' }) };
  const deps = fakeDeps({ rows: [row] });
  await serviceOf(deps).scan({ days: 7 });
  const rec = deps.calls.upserted.find(r => r.ruleId === 'R1');
  assert.equal(rec.title, 'Cache perdu en cours de session : des jetons déjà servis sont refacturés — projet D:\\dvf-postgis-pipeline');
  assert.equal(rec.subject, 'F--dvf', 'the persisted identity stays the slug');
});

// A transcript that never declared a cwd is a real case, not an anomaly: the
// card names the slug rather than going anonymous.
test('a report without a cwd falls back to the slug in the title', async () => {
  const deps = fakeDeps({ rows: [HUMAN_ROW] });
  await serviceOf(deps).scan({ days: 7 });
  const rec = deps.calls.upserted.find(r => r.ruleId === 'R1');
  assert.equal(rec.title, 'Cache perdu en cours de session : des jetons déjà servis sont refacturés — projet F--dvf');
});

test('sessions() exposes projectPath — the real path, or the slug when unknown', async () => {
  const withCwd = { ...HUMAN_ROW, reportJson: JSON.stringify({ ...R1_REPORT, cwd: 'f:\\DEV\\x' }) };
  const [named] = await serviceOf(fakeDeps({ rows: [withCwd] })).sessions();
  assert.equal(named.projectPath, 'F:\\DEV\\x');
  assert.equal(named.project, 'F--dvf');
  assert.equal(named.reportJson, undefined, 'the full report never travels to the table view');

  const [unnamed] = await serviceOf(fakeDeps({ rows: [HUMAN_ROW] })).sessions();
  assert.equal(unnamed.projectPath, 'F--dvf');
});

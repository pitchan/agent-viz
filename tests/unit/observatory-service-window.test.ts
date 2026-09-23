// The two structural rules, pinned: persistence always scans 90 days
// while advice reads the chosen window on the human basis only; every
// recommendation is stamped with the period it was observed on.

import { expect, test } from 'vitest';
import { createObservatoryService, WINDOW_DAYS } from '../../src/server/observatory/service.ts';
import type { Store, SessionRow } from '../../src/server/observatory/store.ts';
import type { Engine } from '../../src/server/observatory/engine.ts';

const NOW = new Date('2026-08-03T12:00:00.000Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 3600 * 1000).toISOString();

// A stored row whose report makes R1 fire (prefixChange dominant, 40 % of net):
// with at least one recommendation emitted, the period-stamp assertions below
// are real, never vacuously true on an empty list. The quiet-zero fields keep
// the other six rules silent instead of throwing.
const stat = (events: number, tokens: number) => ({ events, tokens });
const R1_REPORT = {
  context: {
    churnCauses: {
      prefixChange: stat(1, 40000), compaction: stat(0, 0), expiration: stat(0, 0),
      growth: stat(0, 0), unknown: stat(0, 0),
    },
    prefixBreakdown: {
      markers: {
        modelSwitch: stat(0, 0), systemChanged: stat(0, 0), toolsChanged: stat(0, 0),
        messagesChanged: stat(0, 0), toolsAppeared: stat(0, 0), noMarker: stat(1, 40000),
      },
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
} as unknown as SessionRow;

// Real deps (service.ts head): { store, engine, collectConfig, broadcast,
// now, claudeDir, sinceDays, scanSinceDays } — the engine arrives as a ready
// value, and config collection is a separate collaborator from the store.
function fakeDeps({ rows = [] as SessionRow[] } = {}) {
  const calls: { listSessions: any[]; discoverSince: Date | null; upserted: any[] | null } =
    { listSessions: [], discoverSince: null, upserted: null };
  const store = {
    listSessions: (opts: any) => { calls.listSessions.push(opts); return rows; },
    countByKind: () => ({ interactive: 2, headless: 5, unknown: 1 }),
    listConfigItems: () => [],
    replaceConfigItems: () => {},
    upsertRecommendations: (recs: any) => { calls.upserted = recs; },
    getScanState: () => null,
    setScanState: () => {},
    needsScan: () => false,
  } as unknown as Store;
  const engine = {
    discoverSessions: async (_dir: string, { since }: { since: Date }) => { calls.discoverSince = since; return []; },
    parseSince: (raw: string) => new Date(raw),
    scanSession: async () => { throw new Error('not reached: no session to scan'); },
    netTokens: () => 0,
  } as unknown as Engine;
  return { calls, store, engine };
}

function serviceOf(deps: ReturnType<typeof fakeDeps>) {
  // Mirror the real composition (index.ts): default advice window 30, scan window 90.
  return createObservatoryService({
    engine: deps.engine, store: deps.store,
    collectConfig: async () => [],
    broadcast: () => {}, now: () => NOW,
    adoptPrice: async () => null,
    vigie: { snapshot: () => ({ checkedAt: null, drifts: [] }), refresh: async () => true },
    claudeDir: 'C:\\Users\\x\\.claude', sinceDays: 30, scanSinceDays: 90,
  });
}

test('WINDOW_DAYS is the 7/30/90 spec table', () => {
  expect(WINDOW_DAYS).toEqual([7, 30, 90]);
});

test('summary defaults: 30-day window, human kinds only, basis passed through', async () => {
  const deps = fakeDeps();
  const out = await serviceOf(deps).summary();
  const q = deps.calls.listSessions[0];
  expect(q.kinds).toEqual(['interactive']);
  expect(q.since).toBe(daysAgo(30));
  expect(out.basis!.counts).toEqual({ interactive: 2, headless: 5, unknown: 1 });
  expect(out.basis!.includeMachine).toBe(false);
  expect(out.period).toEqual({ from: daysAgo(30), to: NOW.toISOString(), days: 30 });
});

test('summary({days: 7}) narrows the window; an off-table value falls back to the default', async () => {
  const deps = fakeDeps();
  await serviceOf(deps).summary({ days: 7 });
  expect(deps.calls.listSessions[0].since).toBe(daysAgo(7));
  await serviceOf(fakeDeps()).summary({ days: 12 }).then(out =>
    expect(out.period!.days, 'off-table windows are never honored silently').toBe(30));
});

test('summary({includeMachine: true}) lifts the kind filter but still announces the basis', async () => {
  const deps = fakeDeps();
  const out = await serviceOf(deps).summary({ includeMachine: true });
  expect(deps.calls.listSessions[0].kinds).toBe(undefined);
  expect(out.basis!.includeMachine).toBe(true);
});

test('scan persists 90 days but evaluates advice on the requested window, human only, and stamps the period', async () => {
  const deps = fakeDeps({ rows: [HUMAN_ROW] });
  await serviceOf(deps).scan({ days: 7 });
  expect(deps.calls.discoverSince!.toISOString(), 'persistence window never shrinks').toBe(daysAgo(90));
  const adviceQuery = deps.calls.listSessions.find(q => q.kinds);
  expect(adviceQuery.kinds).toEqual(['interactive']);
  expect(adviceQuery.since).toBe(daysAgo(7));
  expect(deps.calls.upserted!.length >= 1, 'the R1 fixture must produce at least one recommendation').toBeTruthy();
  for (const rec of deps.calls.upserted!) {
    expect(rec.periodFrom).toBe(daysAgo(7));
    expect(rec.periodTo).toBe(NOW.toISOString());
  }
});

// The project label is put on here and nowhere else: the rules only carry the
// slug as an identity. The service is therefore the seam that must be pinned.
test('scan names the project with the real working directory, keeping the slug as identity', async () => {
  const row = { ...HUMAN_ROW, reportJson: JSON.stringify({ ...R1_REPORT, cwd: 'd:\\dvf-postgis-pipeline' }) };
  const deps = fakeDeps({ rows: [row] });
  await serviceOf(deps).scan({ days: 7 });
  const rec = deps.calls.upserted!.find(r => r.ruleId === 'R1');
  expect(rec.title).toBe('Cache perdu en cours de session : des jetons déjà servis sont refacturés — projet D:\\dvf-postgis-pipeline');
  expect(rec.subject, 'the persisted identity stays the slug').toBe('F--dvf');
});

// A transcript that never declared a cwd is a real case, not an anomaly: the
// card names the slug rather than going anonymous.
test('a report without a cwd falls back to the slug in the title', async () => {
  const deps = fakeDeps({ rows: [HUMAN_ROW] });
  await serviceOf(deps).scan({ days: 7 });
  const rec = deps.calls.upserted!.find(r => r.ruleId === 'R1');
  expect(rec.title).toBe('Cache perdu en cours de session : des jetons déjà servis sont refacturés — projet F--dvf');
});

test('sessions() exposes projectPath — the real path, or the slug when unknown', async () => {
  const withCwd = { ...HUMAN_ROW, reportJson: JSON.stringify({ ...R1_REPORT, cwd: 'f:\\DEV\\x' }) };
  const [named] = await serviceOf(fakeDeps({ rows: [withCwd] })).sessions();
  expect(named!.projectPath).toBe('F:\\DEV\\x');
  expect(named!.project).toBe('F--dvf');
  expect((named as unknown as Record<string, unknown>).reportJson, 'the full report never travels to the table view').toBe(undefined);

  const [unnamed] = await serviceOf(fakeDeps({ rows: [HUMAN_ROW] })).sessions();
  expect(unnamed!.projectPath).toBe('F--dvf');
});

test('skillUsage reads the chosen window on the human basis and attaches basis and period', async () => {
  // Arrange
  const deps = fakeDeps();
  // Act
  const out = await serviceOf(deps).skillUsage({ days: 7 });
  // Assert
  expect(deps.calls.listSessions[0]).toEqual({ since: daysAgo(7), kinds: ['interactive'] });
  expect(out.period).toEqual({ from: daysAgo(7), to: NOW.toISOString(), days: 7 });
  expect(out.basis.includeMachine).toBe(false);
});

test('skillUsage counts a stored row without skill facts as pending rescan', async () => {
  // Arrange
  const deps = fakeDeps({ rows: [HUMAN_ROW] });
  // Act
  const out = await serviceOf(deps).skillUsage();
  // Assert
  expect(out).toMatchObject({ sessionsCounted: 0, excludedPendingRescan: 1 });
});

test('skillUsage ne garde que les sessions du projet demandé', async () => {
  // Arrange — deux sessions lues, deux projets
  const withSkills = (id: string, project: string) => ({
    ...HUMAN_ROW, id, project,
    reportJson: JSON.stringify({ ...R1_REPORT, skills: { listed: ['pptx'], calls: { pptx: 1 }, attributed: [] } }),
  } as unknown as SessionRow);
  const deps = fakeDeps({ rows: [withSkills('s1', 'F--a'), withSkills('s2', 'F--b')] });
  // Act
  const out = await serviceOf(deps).skillUsage({ project: 'F--a' });
  // Assert
  expect(out.sessionsCounted).toBe(1);
  expect(out.projects.map(p => p.project)).toEqual(['F--a', 'F--b']);
});

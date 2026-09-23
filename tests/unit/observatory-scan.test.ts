// Incremental scan orchestration. The engine, the clock and the SSE transport
// are injected, so this runs without netgain and without files.

import { expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runIncrementalScan } from '../../src/server/observatory/scan.ts';
import type { AnalysisScanMessage } from '../../src/server/observatory/scan.ts';
import { openStore } from '../../src/server/observatory/store.ts';
import { SCAN_VERSION } from '../../src/server/observatory/scan-version.ts';
import type { SessionRef } from '../../src/engine/core/discovery.ts';
import type { SessionReport } from '../../src/engine/doctor/report/types.ts';
import { fakeReport, fakeRef } from '../helpers/observatory-fakes.ts';

function harness(refs: SessionRef[], scan: (ref: SessionRef) => Promise<SessionReport>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'obs-scan-'));
  const messages: AnalysisScanMessage[] = [];
  const store = openStore(path.join(dir, 'observatory.db'));
  return {
    dir, messages, store,
    deps: {
      engine: {
        discoverSessions: async (_claudeDir: string, _filters: { since: Date }) => refs,
        scanSession: scan,
      },
      store,
      broadcast: (m: AnalysisScanMessage) => messages.push(m),
      now: () => new Date('2026-07-15T12:00:00.000Z'),
    },
  };
}
const cleanup = (h: ReturnType<typeof harness>) => { h.store.close(); fs.rmSync(h.dir, { recursive: true, force: true }); };
const OPTS = { claudeDir: 'C:\\x\\.claude', sinceDays: 30 };

test('first run scans every discovered session and stores one row each', async () => {
  const h = harness([fakeRef('s1'), fakeRef('s2')], async ref => fakeReport(ref.sessionId));
  try {
    const out = await runIncrementalScan(h.deps, OPTS);
    expect({ discovered: out.discovered, scanned: out.scanned, skipped: out.skipped, failed: out.failed }).toEqual({ discovered: 2, scanned: 2, skipped: 0, failed: 0 });
    expect(h.store.listSessions({}).length).toBe(2);
    expect(h.store.getSession('s1')!.modelMain).toBe('claude-opus-4-8');
    expect(h.store.getSession('s1')!.scanVersion).toBe(SCAN_VERSION);
  } finally { cleanup(h); }
});

test('second run with unchanged files skips everything', async () => {
  let calls = 0;
  const h = harness([fakeRef('s1')], async ref => { calls++; return fakeReport(ref.sessionId); });
  try {
    await runIncrementalScan(h.deps, OPTS);
    const out = await runIncrementalScan(h.deps, OPTS);
    expect(calls, 'scanSession must not be called again').toBe(1);
    expect({ scanned: out.scanned, skipped: out.skipped }).toEqual({ scanned: 0, skipped: 1 });
  } finally { cleanup(h); }
});

test('a bumped scan version forces a full rescan', async () => {
  let calls = 0;
  const h = harness([fakeRef('s1')], async ref => { calls++; return fakeReport(ref.sessionId); });
  try {
    await runIncrementalScan(h.deps, OPTS);
    const out = await runIncrementalScan(h.deps, { ...OPTS, scanVersion: SCAN_VERSION + 1 });
    expect(calls).toBe(2);
    expect(out.scanned).toBe(1);
  } finally { cleanup(h); }
});

test('a session that throws is counted as failed and never stops the scan', async () => {
  const h = harness([fakeRef('bad'), fakeRef('good')], async ref => {
    if (ref.sessionId === 'bad') throw new Error('transcript illisible');
    return fakeReport(ref.sessionId);
  });
  try {
    const out = await runIncrementalScan(h.deps, OPTS);
    expect({ scanned: out.scanned, failed: out.failed }).toEqual({ scanned: 1, failed: 1 });
    expect(h.store.listSessions({}).map(s => s.id)).toEqual(['good']);
  } finally { cleanup(h); }
});

test('a report flagged skipped by the engine is counted, not stored as a free session', async () => {
  const h = harness([fakeRef('s1')],
    async ref => fakeReport(ref.sessionId, { skipped: 'transcript principal illisible' }));
  try {
    const out = await runIncrementalScan(h.deps, OPTS);
    expect({ scanned: out.scanned, failed: out.failed }).toEqual({ scanned: 0, failed: 1 });
    expect(h.store.listSessions({}).length).toBe(0);
  } finally { cleanup(h); }
});

test("progress is broadcast as start then per-session progress — 'done' belongs to the service", async () => {
  // 'done' is the client's reload signal and must wait for the advice write,
  // so runIncrementalScan never emits it (see observatory-scan-done-order).
  const h = harness([fakeRef('s1'), fakeRef('s2')], async ref => fakeReport(ref.sessionId));
  try {
    await runIncrementalScan(h.deps, OPTS);
    expect(h.messages.map(m => m.phase)).toEqual(['start', 'progress', 'progress']);
    expect(h.messages.every(m => m.type === 'analysisScan')).toBeTruthy();
    expect(h.messages[0]!.total).toBe(2);
    expect(h.messages.at(-1)!.scanned).toBe(2);
  } finally { cleanup(h); }
});

test('the scan window is passed to the engine as a since date', async () => {
  let seen: Date | null = null;
  const h = harness([], async () => fakeReport('none'));
  h.deps.engine.discoverSessions = async (_dir, filters) => { seen = filters.since; return []; };
  try {
    await runIncrementalScan(h.deps, OPTS);
    expect(seen!.toISOString()).toBe('2026-06-15T12:00:00.000Z');
  } finally { cleanup(h); }
});

test('the scan state records when and with which scan version', async () => {
  const h = harness([], async () => fakeReport('none'));
  try {
    await runIncrementalScan(h.deps, OPTS);
    expect(h.store.getScanState('C:\\x\\.claude')).toEqual({ lastScanAt: '2026-07-15T12:00:00.000Z', engineVersion: String(SCAN_VERSION) });
  } finally { cleanup(h); }
});

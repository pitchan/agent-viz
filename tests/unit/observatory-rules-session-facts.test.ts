// R3, R4, R5 — rules that read one SessionReport and nothing else.
//
// Family names are the ones netgain actually produces: a Bash tool_use becomes
// its command name ("npm test", "cat"), any other tool becomes the tool name
// verbatim ("Read", "Grep", "mcp__x__y"). R3's population depends on that
// distinction, so the fixtures use the real shapes.

import { expect, test } from 'vitest';
import * as r3 from '../../src/server/observatory/rules/r3-large-tool-output.ts';
import * as r4 from '../../src/server/observatory/rules/r4-cross-agent-reads.ts';
import * as r5 from '../../src/server/observatory/rules/r5-compactions.ts';
import type { Session } from '../../src/server/observatory/rules/types.ts';

const KB = 1024;

function session(id: string, report: Record<string, unknown>, { project = 'F--proj', netTokens = 100000, costUsd = 10, costComplete = true } = {}) {
  return {
    id, project, startedAt: '2026-07-01T10:00:00.000Z', endedAt: '2026-07-01T11:00:00.000Z',
    netTokens, costUsd, costComplete, report,
  } as unknown as Session;
}

const toolReport = (candidateFilters: Array<{ family: string; count: number; bytes: number }>, totalBytes: number) => ({
  toolResults: { candidateFilters, totalBytes },
});
const readsReport = (dupBytes: number, dupCount: number, totalBytes: number) => ({
  reads: { totalBytes, cases: { crossAgentDuplicate: { count: dupCount, bytes: dupBytes } } },
});
const compactReport = (compactions: Array<{ trigger: string; preTokens: number | null }>) => ({ context: { compactions } });

const ctx = (sessions: Session[]) => ({ sessions, configItems: [] });

// ─── R3 ───────────────────────────────────────────────────────────────────

test('R3 names the offending command family and prices it as a byte approximation', () => {
  const recs = r3.evaluate(ctx([
    session('s1', toolReport([{ family: 'npm test', count: 6, bytes: 200 * KB }], 1000 * KB)),
  ]));
  expect(recs.length).toBe(1);
  expect(recs[0]!.ruleId).toBe('R3');
  expect(recs[0]!.subject).toBe('npm test');
  expect(recs[0]!.confidence).toBe('fait');
  expect(recs[0]!.costBasis).toBe('octets-approx-4o-par-jeton');
  expect(recs[0]!.evidence.bytes).toBe(200 * KB);
  expect(recs[0]!.evidence.count).toBe(6);
  expect(Math.round(recs[0]!.evidence.shareOfToolBytesPercent)).toBe(20);
  expect(recs[0]!.title.includes('npm test')).toBeTruthy();
});

test('R3 aggregates one family across sessions before applying its floors', () => {
  const recs = r3.evaluate(ctx([
    session('s1', toolReport([{ family: 'ls', count: 3, bytes: 100 * KB }], 500 * KB)),
    session('s2', toolReport([{ family: 'ls', count: 3, bytes: 100 * KB }], 500 * KB)),
  ]));
  expect(recs.length).toBe(1);
  expect(recs[0]!.evidence.count).toBe(6);
  expect(recs[0]!.evidence.sessions).toEqual(['s1', 's2']);
});

test('R3 stays silent below its share of tool output or below its occurrence floor', () => {
  expect(r3.evaluate(ctx([
    session('s1', toolReport([{ family: 'cat', count: 9, bytes: 10 * KB }], 10000 * KB)),
  ])), 'tiny share of the period').toEqual([]);
  expect(r3.evaluate(ctx([
    session('s1', toolReport([{ family: 'cat', count: 2, bytes: 900 * KB }], 1000 * KB)),
  ])), 'big but not repeated').toEqual([]);
});

test('R3 stays silent with no candidate filters at all', () => {
  expect(r3.evaluate(ctx([session('s1', toolReport([], 1000 * KB))]))).toEqual([]);
});

// R3's action is "target the command — filter, pagination, narrower test": an
// agent tool has no filter to add, so its large outputs are not an action. The
// calibration relevé found most families above the thresholds were agent tools.
test('R3 ignores agent-tool families — only a shell command has a filter to add', () => {
  for (const family of ['Read', 'Grep', 'Agent', 'Glob', 'WebFetch', 'WebSearch',
    'PowerShell', 'ExitPlanMode', 'Bash', 'mcp__mdb-explorer__mdb_geocode']) {
    expect(r3.evaluate(ctx([session('s1', toolReport([{ family, count: 7814, bytes: 900 * KB }], 1000 * KB))])), `${family} must not produce advice`).toEqual([]);
  }
});

test('R3 still fires on a command family sharing the period with agent tools', () => {
  const recs = r3.evaluate(ctx([
    session('s1', toolReport([
      { family: 'Read', count: 7814, bytes: 700 * KB },
      { family: 'cat', count: 529, bytes: 200 * KB },
    ], 1000 * KB)),
  ]));
  expect(recs.map(r => r.subject)).toEqual(['cat']);
  // The share denominator stays the period's whole tool output — the excluded
  // families were still paid for, they are just not actionable.
  expect(Math.round(recs[0]!.evidence.shareOfToolBytesPercent)).toBe(20);
});

// ─── R4 ───────────────────────────────────────────────────────────────────

test('R4 fires on cross-agent duplicate reads above both floors', () => {
  const recs = r4.evaluate(ctx([session('s1', readsReport(500 * KB, 12, 2000 * KB))]));
  expect(recs.length).toBe(1);
  expect(recs[0]!.ruleId).toBe('R4');
  expect(recs[0]!.subject).toBe('F--proj');
  expect(recs[0]!.costBasis).toBe('octets-approx-4o-par-jeton');
  expect(recs[0]!.evidence.duplicateBytes).toBe(500 * KB);
  expect(recs[0]!.evidence.duplicateCount).toBe(12);
  expect(Math.round(recs[0]!.evidence.shareOfReadBytesPercent)).toBe(25);
});

test('R4 stays silent below the absolute floor or below its share of read volume', () => {
  expect(r4.evaluate(ctx([session('s1', readsReport(50 * KB, 3, 60 * KB))]))).toEqual([]);
  expect(r4.evaluate(ctx([session('s1', readsReport(200 * KB, 3, 100000 * KB))]))).toEqual([]);
});

test('R4 stays silent when nothing was read at all', () => {
  expect(r4.evaluate(ctx([session('s1', readsReport(0, 0, 0))]))).toEqual([]);
});

// ─── R5 ───────────────────────────────────────────────────────────────────

test('R5 fires from two compactions and prices the re-processed tokens', () => {
  const recs = r5.evaluate(ctx([
    session('s1', compactReport([
      { trigger: 'auto', preTokens: 120000 },
      { trigger: 'auto', preTokens: 130000 },
    ])),
  ]));
  expect(recs.length).toBe(1);
  expect(recs[0]!.ruleId).toBe('R5');
  expect(recs[0]!.subject).toBe('F--proj');
  expect(recs[0]!.costBasis).toBe('jetons-mesures');
  expect(recs[0]!.evidence.compactions).toBe(2);
  expect(recs[0]!.evidence.reprocessedTokens).toBe(250000);
  expect(recs[0]!.estimatedCostUsd).toBe(25);
});

test('R5 ignores a single compaction', () => {
  expect(r5.evaluate(ctx([session('s1', compactReport([{ trigger: 'auto', preTokens: 120000 }]))]))).toEqual([]);
});

test('R5 counts a compaction with unknown preTokens apart, never as a zero', () => {
  const recs = r5.evaluate(ctx([
    session('s1', compactReport([
      { trigger: 'auto', preTokens: 100000 },
      { trigger: 'manual', preTokens: null },
    ])),
  ]));
  expect(recs[0]!.evidence.reprocessedTokens).toBe(100000);
  expect(recs[0]!.evidence.compactionsWithoutTokenCount).toBe(1);
});

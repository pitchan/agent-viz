'use strict';
// R3, R4, R5 — rules that read one SessionReport and nothing else.
//
// Family names are the ones netgain actually produces: a Bash tool_use becomes
// its command name ("npm test", "cat"), any other tool becomes the tool name
// verbatim ("Read", "Grep", "mcp__x__y"). R3's population depends on that
// distinction, so the fixtures use the real shapes.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const r3 = require('../../src/server/observatory/rules/r3-large-tool-output.ts');
const r4 = require('../../src/server/observatory/rules/r4-cross-agent-reads.ts');
const r5 = require('../../src/server/observatory/rules/r5-compactions.ts');

const KB = 1024;

function session(id, report, { project = 'F--proj', netTokens = 100000, costUsd = 10, costComplete = true } = {}) {
  return {
    id, project, startedAt: '2026-07-01T10:00:00.000Z', endedAt: '2026-07-01T11:00:00.000Z',
    netTokens, costUsd, costComplete, report,
  };
}

const toolReport = (candidateFilters, totalBytes) => ({
  toolResults: { candidateFilters, totalBytes },
});
const readsReport = (dupBytes, dupCount, totalBytes) => ({
  reads: { totalBytes, cases: { crossAgentDuplicate: { count: dupCount, bytes: dupBytes } } },
});
const compactReport = compactions => ({ context: { compactions } });

const ctx = sessions => ({ sessions, configItems: [] });

// ─── R3 ───────────────────────────────────────────────────────────────────

test('R3 names the offending command family and prices it as a byte approximation', () => {
  const recs = r3.evaluate(ctx([
    session('s1', toolReport([{ family: 'npm test', count: 6, bytes: 200 * KB }], 1000 * KB)),
  ]));
  assert.equal(recs.length, 1);
  assert.equal(recs[0].ruleId, 'R3');
  assert.equal(recs[0].subject, 'npm test');
  assert.equal(recs[0].confidence, 'fait');
  assert.equal(recs[0].costBasis, 'octets-approx-4o-par-jeton');
  assert.equal(recs[0].evidence.bytes, 200 * KB);
  assert.equal(recs[0].evidence.count, 6);
  assert.equal(Math.round(recs[0].evidence.shareOfToolBytesPercent), 20);
  assert.ok(recs[0].title.includes('npm test'));
});

test('R3 aggregates one family across sessions before applying its floors', () => {
  const recs = r3.evaluate(ctx([
    session('s1', toolReport([{ family: 'ls', count: 3, bytes: 100 * KB }], 500 * KB)),
    session('s2', toolReport([{ family: 'ls', count: 3, bytes: 100 * KB }], 500 * KB)),
  ]));
  assert.equal(recs.length, 1);
  assert.equal(recs[0].evidence.count, 6);
  assert.deepEqual(recs[0].evidence.sessions, ['s1', 's2']);
});

test('R3 stays silent below its share of tool output or below its occurrence floor', () => {
  assert.deepEqual(r3.evaluate(ctx([
    session('s1', toolReport([{ family: 'cat', count: 9, bytes: 10 * KB }], 10000 * KB)),
  ])), [], 'tiny share of the period');
  assert.deepEqual(r3.evaluate(ctx([
    session('s1', toolReport([{ family: 'cat', count: 2, bytes: 900 * KB }], 1000 * KB)),
  ])), [], 'big but not repeated');
});

test('R3 stays silent with no candidate filters at all', () => {
  assert.deepEqual(r3.evaluate(ctx([session('s1', toolReport([], 1000 * KB))])), []);
});

// Population restriction decided on 2026-07-27 from the calibration relevé: of
// the 17 families that cleared the thresholds, 15 were agent tools rather than
// commands. R3's action is "target the command — filter, pagination, narrower
// test", and an agent tool has no filter to add, so telling the user their Read
// calls are large is not an action. Scope deliberately narrow: two pieces of
// advice that hold beat seventeen of which fifteen are inapplicable.
test('R3 ignores agent-tool families — only a shell command has a filter to add', () => {
  for (const family of ['Read', 'Grep', 'Agent', 'Glob', 'WebFetch', 'WebSearch',
    'PowerShell', 'ExitPlanMode', 'Bash', 'mcp__mdb-explorer__mdb_geocode']) {
    assert.deepEqual(
      r3.evaluate(ctx([session('s1', toolReport([{ family, count: 7814, bytes: 900 * KB }], 1000 * KB))])),
      [], `${family} must not produce advice`);
  }
});

test('R3 still fires on a command family sharing the period with agent tools', () => {
  const recs = r3.evaluate(ctx([
    session('s1', toolReport([
      { family: 'Read', count: 7814, bytes: 700 * KB },
      { family: 'cat', count: 529, bytes: 200 * KB },
    ], 1000 * KB)),
  ]));
  assert.deepEqual(recs.map(r => r.subject), ['cat']);
  // The share denominator stays the period's whole tool output — the excluded
  // families were still paid for, they are just not actionable.
  assert.equal(Math.round(recs[0].evidence.shareOfToolBytesPercent), 20);
});

// ─── R4 ───────────────────────────────────────────────────────────────────

test('R4 fires on cross-agent duplicate reads above both floors', () => {
  const recs = r4.evaluate(ctx([session('s1', readsReport(500 * KB, 12, 2000 * KB))]));
  assert.equal(recs.length, 1);
  assert.equal(recs[0].ruleId, 'R4');
  assert.equal(recs[0].subject, 'F--proj');
  assert.equal(recs[0].costBasis, 'octets-approx-4o-par-jeton');
  assert.equal(recs[0].evidence.duplicateBytes, 500 * KB);
  assert.equal(recs[0].evidence.duplicateCount, 12);
  assert.equal(Math.round(recs[0].evidence.shareOfReadBytesPercent), 25);
});

test('R4 stays silent below the absolute floor or below its share of read volume', () => {
  assert.deepEqual(r4.evaluate(ctx([session('s1', readsReport(50 * KB, 3, 60 * KB))])), []);
  assert.deepEqual(r4.evaluate(ctx([session('s1', readsReport(200 * KB, 3, 100000 * KB))])), []);
});

test('R4 stays silent when nothing was read at all', () => {
  assert.deepEqual(r4.evaluate(ctx([session('s1', readsReport(0, 0, 0))])), []);
});

// ─── R5 ───────────────────────────────────────────────────────────────────

test('R5 fires from two compactions and prices the re-processed tokens', () => {
  const recs = r5.evaluate(ctx([
    session('s1', compactReport([
      { trigger: 'auto', preTokens: 120000 },
      { trigger: 'auto', preTokens: 130000 },
    ])),
  ]));
  assert.equal(recs.length, 1);
  assert.equal(recs[0].ruleId, 'R5');
  assert.equal(recs[0].subject, 'F--proj');
  assert.equal(recs[0].costBasis, 'jetons-mesures');
  assert.equal(recs[0].evidence.compactions, 2);
  assert.equal(recs[0].evidence.reprocessedTokens, 250000);
  assert.equal(recs[0].estimatedCostUsd, 25);
});

test('R5 ignores a single compaction', () => {
  assert.deepEqual(r5.evaluate(ctx([session('s1', compactReport([{ trigger: 'auto', preTokens: 120000 }]))])), []);
});

test('R5 counts a compaction with unknown preTokens apart, never as a zero', () => {
  const recs = r5.evaluate(ctx([
    session('s1', compactReport([
      { trigger: 'auto', preTokens: 100000 },
      { trigger: 'manual', preTokens: null },
    ])),
  ]));
  assert.equal(recs[0].evidence.reprocessedTokens, 100000);
  assert.equal(recs[0].evidence.compactionsWithoutTokenCount, 1);
});

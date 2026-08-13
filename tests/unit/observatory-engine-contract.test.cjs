'use strict';
// Contract test for the netgain engine boundary. Every field path asserted
// here is one the product actually reads. If netgain changes its report
// shape, this test fails loudly in CI instead of silently degrading a rule
// to zero on a user's machine.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { loadEngine, engineStatus, FIXTURE_CLAUDE_DIR } = require('../../src/server/observatory/engine');

test('loadEngine resolves the granular netgain API', async () => {
  const engine = await loadEngine();
  assert.equal(typeof engine.discoverSessions, 'function');
  assert.equal(typeof engine.scanSession, 'function');
  assert.equal(typeof engine.netTokens, 'function');
  assert.deepEqual(engineStatus(), { ok: true, error: null });
});

test('FIXTURE_CLAUDE_DIR points at the versioned observatory fixture', () => {
  assert.equal(path.basename(FIXTURE_CLAUDE_DIR), 'observatory');
});

test('the SessionReport shape the product consumes is present and typed', async () => {
  const { discoverSessions, scanSession, netTokens } = await loadEngine();
  const refs = await discoverSessions(FIXTURE_CLAUDE_DIR, {});
  const ref = refs.find(r => r.sessionId === 'sess-fixture');
  assert.ok(ref, 'fixture session must be discoverable');
  assert.equal(typeof ref.mtime.getTime(), 'number');
  assert.equal(typeof ref.sizeBytes, 'number');

  const r = await scanSession(ref, 100);

  // Identity and duration (R6 depends on both timestamps).
  assert.equal(r.sessionId, 'sess-fixture');
  assert.equal(r.projectSlug, 'F--obs-fixture');
  assert.equal(r.startedAt, '2026-07-01T10:00:00.000Z');
  // The session clock is fed by assistant, tool_result and user_prompt events
  // only — a compact boundary carries no normalised timestamp. The fixture ends
  // on a compaction at 10:02, and endedAt is deliberately the last event that
  // does carry a clock reading. Pinned here so a future engine change that
  // moves the clock is seen rather than absorbed by R6's duration.
  assert.equal(r.endedAt, '2026-07-01T10:01:30.000Z');

  // M1.1 — session shape. The M1 fixture prompt is a RAW STRING, so the
  // engine must classify it headless: pinning that value proves the sort.
  assert.equal(r.sessionKind, 'headless');

  // M1.1 — silent-break ventilation: same shape as every ChurnCauseStat,
  // and the sub-buckets always sum to the parent bucket (homogeneity rule).
  const nm = r.context.prefixBreakdown.markers.noMarker;
  assert.equal(typeof nm.tokens, 'number');
  assert.equal(typeof nm.events, 'number');
  for (const key of ['earlyMcp', 'other']) {
    assert.equal(typeof r.context.prefixBreakdown.noMarkerDetail[key].tokens, 'number', `noMarkerDetail.${key}`);
    assert.equal(typeof r.context.prefixBreakdown.noMarkerDetail[key].events, 'number');
  }
  assert.equal(
    r.context.prefixBreakdown.noMarkerDetail.earlyMcp.tokens
      + r.context.prefixBreakdown.noMarkerDetail.other.tokens,
    nm.tokens);

  // Cost and tokens.
  assert.equal(typeof r.netTokens, 'number');
  assert.equal(typeof r.tokens.costUsd, 'number');
  assert.equal(typeof r.tokens.costComplete, 'boolean');
  assert.equal(typeof r.tokens.total.cacheRead, 'number');
  assert.equal(typeof r.tokens.perModel, 'object');
  // perAgent holds SUBAGENTS ONLY — the main agent has its own bucket, and
  // total is the sum of both. R6 sums perAgent directly to get the subagent
  // spend, so this separation is part of the contract, not an implementation
  // detail.
  assert.equal(typeof r.tokens.main.cacheCreate, 'number');
  assert.deepEqual(Object.keys(r.tokens.perAgent), ['agent-aaa']);
  assert.equal(typeof netTokens(r.tokens.total), 'number');

  // R1 — churn causes.
  for (const cause of ['prefixChange', 'compaction', 'expiration', 'growth', 'unknown']) {
    assert.equal(typeof r.context.churnCauses[cause].tokens, 'number', `churnCauses.${cause}`);
    assert.equal(typeof r.context.churnCauses[cause].events, 'number');
  }
  // R2 — the "tools appeared" marker carries R2's measured cost.
  assert.equal(typeof r.context.prefixBreakdown.markers.toolsAppeared.tokens, 'number');

  // R5 — compactions.
  assert.ok(Array.isArray(r.context.compactions));
  assert.equal(r.context.compactions[0].preTokens, 120000);

  // R2 + R3 — tool results.
  assert.equal(typeof r.toolResults.byTool, 'object');
  assert.ok(Object.keys(r.toolResults.byTool).some(n => n.startsWith('mcp__')));
  assert.equal(typeof r.toolResults.totalBytes, 'number');
  assert.ok(Array.isArray(r.toolResults.candidateFilters));

  // R4 — cross-agent duplicate reads live under .cases, not at the root.
  assert.equal(typeof r.reads.cases.crossAgentDuplicate.bytes, 'number');
  assert.equal(typeof r.reads.cases.crossAgentDuplicate.count, 'number');
  assert.equal(typeof r.reads.totalBytes, 'number');

  // R6 — subagent spawns.
  assert.equal(typeof r.subagents.spawnToolUses, 'number');
  assert.ok(r.subagents.spawnToolUses >= 1);

  // Honesty surface.
  assert.equal(typeof r.parseErrors, 'number');
  assert.equal(r.skipped, undefined);
});

test('a blocks-shaped prompt session is classified interactive', async () => {
  const { discoverSessions, scanSession } = await loadEngine();
  const refs = await discoverSessions(FIXTURE_CLAUDE_DIR, {});
  const ref = refs.find(r => r.sessionId === 'sess-fixture-interactive');
  assert.ok(ref, 'interactive fixture must be discoverable');
  const r = await scanSession(ref, 100);
  assert.equal(r.sessionKind, 'interactive');
});

test('the engine exposes the embedded price table and its version (v0.5.0 surface)', async () => {
  const engine = await loadEngine();
  const table = engine.priceTable();
  assert.equal(table.source, 'netgain-table-embarquee');
  assert.equal(table.unit, 'usd-par-jeton');
  assert.ok(table.entries.length >= 11);
  assert.ok(table.entries.every(e => e.label && e.maxInput > 0 && typeof e.current.input === 'number'));
  assert.ok(Array.isArray(table.zeroCost) && table.zeroCost.length >= 2);
  assert.match(engine.version, /^\d+\.\d+\.\d+$/);
  // Un seul outil, une seule version : le moteur ne peut plus dériver du produit.
  assert.equal(engine.version, require('../../package.json').version);
});

test('the SessionReport carries per-model dollars (costByModel)', async () => {
  const { discoverSessions, scanSession } = await loadEngine();
  const refs = await discoverSessions(FIXTURE_CLAUDE_DIR, {});
  const ref = refs.find(r => r.sessionId === 'sess-fixture');
  const r = await scanSession(ref, 100);
  const cbm = r.tokens.costByModel;
  assert.ok(cbm && typeof cbm === 'object');
  assert.deepEqual(Object.keys(cbm).sort(), Object.keys(r.tokens.perModel).sort());
  const sum = Object.values(cbm).reduce((a, m) => a + (m.usd ?? 0), 0);
  assert.ok(Math.abs(sum - r.tokens.costUsd) < 1e-9, 'sum of per-model dollars = session cost');
  for (const mc of Object.values(cbm)) {
    assert.ok(mc.usd === null || typeof mc.usd === 'number');
    assert.ok(['tarife', 'zero-voulu', 'inconnu'].includes(mc.pricing));
  }
});

test('the announced price source IS the engine table source — one voice', async () => {
  const { PRICE_SOURCE } = require('../../src/server/observatory/routes');
  const engine = await loadEngine();
  assert.equal(engine.priceTable().source, PRICE_SOURCE);
});

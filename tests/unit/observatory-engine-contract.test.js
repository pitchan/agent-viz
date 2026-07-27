'use strict';
// Contract test for the netgain engine boundary. Every field path asserted
// here is one the product actually reads. If netgain changes its report
// shape, this test fails loudly in CI instead of silently degrading a rule
// to zero on a user's machine.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { loadEngine, engineStatus, FIXTURE_CLAUDE_DIR } = require('../../lib/server/observatory/engine');

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

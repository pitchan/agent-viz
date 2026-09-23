// Contract test for the netgain engine boundary. Every field path asserted
// here is one the product actually reads. If netgain changes its report
// shape, this test fails loudly in CI instead of silently degrading a rule
// to zero on a user's machine.

import { expect, test } from 'vitest';
import path from 'node:path';

import { engine } from '../../src/server/observatory/engine.ts';
import { PRICE_SOURCE } from '../../src/server/observatory/routes.ts';
import pkg from '../../package.json' with { type: 'json' };

const FIXTURE_CLAUDE_DIR = path.join(__dirname, '..', 'fixtures', 'observatory');

test('the engine exposes the granular netgain API', () => {
  expect(typeof engine.discoverSessions).toBe('function');
  expect(typeof engine.scanSession).toBe('function');
  expect(typeof engine.netTokens).toBe('function');
});

test('the SessionReport shape the product consumes is present and typed', async () => {
  const { discoverSessions, scanSession, netTokens } = engine;
  const refs = await discoverSessions(FIXTURE_CLAUDE_DIR, {});
  const ref = refs.find(r => r.sessionId === 'sess-fixture')!;
  expect(ref, 'fixture session must be discoverable').toBeTruthy();
  expect(typeof ref.mtime.getTime()).toBe('number');
  expect(typeof ref.sizeBytes).toBe('number');

  const r = await scanSession(ref, 100);

  // Identity and duration (R6 depends on both timestamps).
  expect(r.sessionId).toBe('sess-fixture');
  expect(r.projectSlug).toBe('F--obs-fixture');
  expect(r.startedAt).toBe('2026-07-01T10:00:00.000Z');
  // The session clock is fed by assistant, tool_result and user_prompt events
  // only — a compact boundary carries no normalised timestamp. The fixture ends
  // on a compaction at 10:02, and endedAt is deliberately the last event that
  // does carry a clock reading. Pinned here so a future engine change that
  // moves the clock is seen rather than absorbed by R6's duration.
  expect(r.endedAt).toBe('2026-07-01T10:01:30.000Z');

  // Session shape. The fixture prompt is a RAW STRING, so the
  // engine must classify it headless: pinning that value proves the sort.
  expect(r.sessionKind).toBe('headless');

  // Silent-break ventilation: same shape as every ChurnCauseStat,
  // and the sub-buckets always sum to the parent bucket (homogeneity rule).
  const nm = r.context.prefixBreakdown.markers.noMarker;
  expect(typeof nm.tokens).toBe('number');
  expect(typeof nm.events).toBe('number');
  for (const key of ['earlyMcp', 'other'] as const) {
    expect(typeof r.context.prefixBreakdown.noMarkerDetail[key].tokens, `noMarkerDetail.${key}`).toBe('number');
    expect(typeof r.context.prefixBreakdown.noMarkerDetail[key].events).toBe('number');
  }
  expect(r.context.prefixBreakdown.noMarkerDetail.earlyMcp.tokens
      + r.context.prefixBreakdown.noMarkerDetail.other.tokens).toBe(nm.tokens);

  // Cost and tokens.
  expect(typeof r.netTokens).toBe('number');
  expect(typeof r.tokens.costUsd).toBe('number');
  expect(typeof r.tokens.costComplete).toBe('boolean');
  expect(typeof r.tokens.malformedUsageMessages).toBe('number');
  expect(typeof r.tokens.total.cacheRead).toBe('number');
  expect(typeof r.tokens.perModel).toBe('object');
  // perAgent holds SUBAGENTS ONLY — the main agent has its own bucket, and
  // total is the sum of both. R6 sums perAgent directly to get the subagent
  // spend, so this separation is part of the contract, not an implementation
  // detail.
  expect(typeof r.tokens.main.cacheCreate).toBe('number');
  expect(Object.keys(r.tokens.perAgent)).toEqual(['agent-aaa']);
  expect(typeof netTokens(r.tokens.total)).toBe('number');

  // R1 — churn causes.
  for (const cause of ['prefixChange', 'compaction', 'expiration', 'growth', 'unknown'] as const) {
    expect(typeof r.context.churnCauses[cause].tokens, `churnCauses.${cause}`).toBe('number');
    expect(typeof r.context.churnCauses[cause].events).toBe('number');
  }
  // R2 — the "tools appeared" marker carries R2's measured cost.
  expect(typeof r.context.prefixBreakdown.markers.toolsAppeared.tokens).toBe('number');

  // R5 — compactions.
  expect(Array.isArray(r.context.compactions)).toBeTruthy();
  expect(r.context.compactions[0]!.preTokens).toBe(120000);

  // R2 + R3 — tool results.
  expect(typeof r.toolResults.byTool).toBe('object');
  expect(Object.keys(r.toolResults.byTool).some(n => n.startsWith('mcp__'))).toBeTruthy();
  expect(typeof r.toolResults.totalBytes).toBe('number');
  expect(Array.isArray(r.toolResults.candidateFilters)).toBeTruthy();

  // R4 — cross-agent duplicate reads live under .cases, not at the root.
  expect(typeof r.reads.cases.crossAgentDuplicate.bytes).toBe('number');
  expect(typeof r.reads.cases.crossAgentDuplicate.count).toBe('number');
  expect(typeof r.reads.totalBytes).toBe('number');

  // R6 — subagent spawns.
  expect(typeof r.subagents.spawnToolUses).toBe('number');
  expect(r.subagents.spawnToolUses >= 1).toBeTruthy();

  // Honesty surface.
  expect(typeof r.parseErrors).toBe('number');
  expect(r.skipped).toBe(undefined);
});

test('a blocks-shaped prompt session is classified interactive', async () => {
  const { discoverSessions, scanSession } = engine;
  const refs = await discoverSessions(FIXTURE_CLAUDE_DIR, {});
  const ref = refs.find(r => r.sessionId === 'sess-fixture-interactive')!;
  expect(ref, 'interactive fixture must be discoverable').toBeTruthy();
  const r = await scanSession(ref, 100);
  expect(r.sessionKind).toBe('interactive');
});

test('the engine exposes the embedded price table and its version', () => {
  const table = engine.priceTable();
  expect(table.source).toBe('netgain-table-embarquee');
  expect(table.unit).toBe('usd-par-jeton');
  expect(table.entries.length >= 11).toBeTruthy();
  expect(table.entries.every(e => e.label && e.maxInput > 0 && typeof e.current.input === 'number')).toBeTruthy();
  expect(Array.isArray(table.zeroCost) && table.zeroCost.length >= 2).toBeTruthy();
  expect(engine.version).toMatch(/^\d+\.\d+\.\d+$/);
  // Un seul outil, une seule version : la version du moteur est celle du paquet.
  expect(engine.version).toBe(pkg.version);
});

test('the SessionReport carries per-model dollars (costByModel)', async () => {
  const { discoverSessions, scanSession } = engine;
  const refs = await discoverSessions(FIXTURE_CLAUDE_DIR, {});
  const ref = refs.find(r => r.sessionId === 'sess-fixture')!;
  const r = await scanSession(ref, 100);
  const cbm = r.tokens.costByModel;
  expect(cbm && typeof cbm === 'object').toBeTruthy();
  expect(Object.keys(cbm).sort()).toEqual(Object.keys(r.tokens.perModel).sort());
  const sum = Object.values(cbm).reduce((a, m) => a + (m.usd ?? 0), 0);
  expect(Math.abs(sum - r.tokens.costUsd) < 1e-9, 'sum of per-model dollars = session cost').toBeTruthy();
  for (const mc of Object.values(cbm)) {
    expect(mc.usd === null || typeof mc.usd === 'number').toBeTruthy();
    expect(['tarife', 'zero-voulu', 'inconnu'].includes(mc.pricing)).toBeTruthy();
  }
});

test('the announced price source IS the engine table source — one voice', () => {
  expect(engine.priceTable().source).toBe(PRICE_SOURCE);
});

test('the SessionReport carries the skill facts, and no per-skill cost', async () => {
  // Arrange
  const { discoverSessions, scanSession } = engine;
  const refs = await discoverSessions(FIXTURE_CLAUDE_DIR, {});
  const ref = refs.find(r => r.sessionId === 'sess-fixture')!;
  // Act
  const r = await scanSession(ref, 100);
  // Assert
  expect(Array.isArray(r.skills.listed)).toBe(true);
  expect(typeof r.skills.calls).toBe('object');
  expect(Array.isArray(r.skills.attributed)).toBe(true);
  expect(r.tokens).not.toHaveProperty('costBySkill');
});

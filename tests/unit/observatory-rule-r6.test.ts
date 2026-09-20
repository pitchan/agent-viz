// R6 — subagents spawned on a task too short to need them.
//
// tokens.perAgent holds SUBAGENTS ONLY (the main agent has its own bucket) —
// pinned by the engine contract test, which is why the fixture below has no
// "main" key and why the rule sums perAgent as a whole.

import { expect, test } from 'vitest';
import * as r6 from '../../src/server/observatory/rules/r6-short-subagents.ts';
import type { Session } from '../../src/server/observatory/rules/types.ts';

interface SessionOpts {
  project?: string;
  startedAt?: string | null;
  endedAt?: string | null;
  spawnToolUses?: number;
  mainNet?: number;
  subNet?: number;
  netTokens?: number;
  costUsd?: number;
  costComplete?: boolean;
}

function session(id: string, { project = 'F--proj', startedAt = '2026-07-01T10:00:00.000Z',
  endedAt = '2026-07-01T10:02:00.000Z', spawnToolUses = 2, mainNet = 1000, subNet = 900,
  netTokens = 1900, costUsd = 1.9, costComplete = true }: SessionOpts = {}) {
  return {
    id, project, startedAt, endedAt, netTokens, costUsd, costComplete,
    report: {
      subagents: { sidecarCount: 1, spawnToolUses, byType: {} },
      tokens: {
        main: { in: mainNet, out: 0, cacheCreate: 0, cacheRead: 5000 },
        perAgent: {
          'agent-aaa': { in: subNet, out: 0, cacheCreate: 0, cacheRead: 3000 },
        },
      },
    },
  } as unknown as Session;
}

const ctx = (sessions: Session[]) => ({ sessions, configItems: [] });

test('R6 fires on a short session where subagents burn over 30 % of net tokens', () => {
  const recs = r6.evaluate(ctx([session('s1')]));
  expect(recs.length).toBe(1);
  expect(recs[0]!.ruleId).toBe('R6');
  expect(recs[0]!.subject).toBe('F--proj');
  expect(recs[0]!.confidence).toBe('correlation');
  expect(recs[0]!.costBasis).toBe('jetons-mesures');
  expect(recs[0]!.evidence.subagentTokens).toBe(900);
  expect(recs[0]!.evidence.medianDurationSeconds).toBe(120);
  expect(recs[0]!.estimatedCostUsd).toBe(0.9);
});

test('R6 excludes cacheRead from the subagent share', () => {
  // 900 net against 1900 net fires; the 3000 cacheRead must play no part.
  expect(r6.evaluate(ctx([session('s1')]))[0]!.evidence.subagentTokens).toBe(900);
});

test('R6 stays silent on a long session', () => {
  expect(r6.evaluate(ctx([session('s1', { endedAt: '2026-07-01T10:40:00.000Z' })]))).toEqual([]);
});

test('R6 stays silent when subagents stay under 30 % of net tokens', () => {
  expect(r6.evaluate(ctx([session('s1', { subNet: 100, netTokens: 1100 })]))).toEqual([]);
});

test('R6 stays silent with no subagent spawn at all', () => {
  expect(r6.evaluate(ctx([session('s1', { spawnToolUses: 0 })]))).toEqual([]);
});

test('R6 cannot judge a session with no timestamps and stays silent', () => {
  expect(r6.evaluate(ctx([session('s1', { startedAt: null })]))).toEqual([]);
  expect(r6.evaluate(ctx([session('s1', { endedAt: null })]))).toEqual([]);
});

test('R6 aggregates only the short sessions of a project', () => {
  const recs = r6.evaluate(ctx([
    session('s1'), session('s2'), session('s3', { endedAt: '2026-07-01T11:00:00.000Z' }),
  ]));
  expect(recs.length).toBe(1);
  expect(recs[0]!.evidence.sessions).toEqual(['s1', 's2']);
  expect(recs[0]!.evidence.subagentTokens).toBe(1800);
});

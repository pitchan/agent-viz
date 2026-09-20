// R1 — model switched mid-session. A session qualifies when its prefix-change
// churn dominates both compaction and expiration churn AND weighs enough
// against ITS OWN net tokens; the qualifying sessions are then grouped by
// project for display. Both gates are per session — that is how the 90-day
// calibration relevé measured them (private repo, docs/sources-externes.md).

import { expect, test } from 'vitest';
import * as r1 from '../../src/server/observatory/rules/r1-prefix-change.ts';
import { evaluateAll, RULES } from '../../src/server/observatory/rules/registry.ts';
import type { Session, Rule } from '../../src/server/observatory/rules/types.ts';

interface DepthStat { events: number; tokens: number }
interface SessionOpts {
  project?: string;
  prefixChange?: number;
  compaction?: number;
  expiration?: number;
  systemChanged?: number;
  toolsChanged?: number;
  messagesChanged?: number;
  toolsAppeared?: number;
  noMarker?: number;
  depth?: { facade: DepthStat; d10to50: DepthStat; d50to90: DepthStat; tail: DepthStat } | null;
  netTokens?: number;
  costUsd?: number;
  costComplete?: boolean;
}

// The engine guarantees that each breakdown sums exactly to prefixChange, so
// the default puts every unclaimed token on modelSwitch: tests that say nothing
// about markers describe the plain "model was switched" case.
function session(id: string, { project = 'F--proj', prefixChange = 0, compaction = 0, expiration = 0,
  systemChanged = 0, toolsChanged = 0, messagesChanged = 0,
  toolsAppeared = 0, noMarker = 0, depth = null,
  netTokens = 100000, costUsd = 10, costComplete = true }: SessionOpts = {}) {
  return {
    id, project, startedAt: '2026-07-01T10:00:00.000Z', endedAt: '2026-07-01T11:00:00.000Z',
    netTokens, costUsd, costComplete,
    report: {
      context: {
        churnCauses: {
          growth: { events: 0, tokens: 0 },
          compaction: { events: 1, tokens: compaction },
          expiration: { events: 1, tokens: expiration },
          prefixChange: { events: 1, tokens: prefixChange },
          unknown: { events: 0, tokens: 0 },
        },
        prefixBreakdown: {
          markers: {
            modelSwitch: { events: 1, tokens: prefixChange - systemChanged - toolsChanged - messagesChanged - toolsAppeared - noMarker },
            systemChanged: { events: 0, tokens: systemChanged },
            toolsChanged: { events: 0, tokens: toolsChanged },
            messagesChanged: { events: 0, tokens: messagesChanged },
            toolsAppeared: { events: 0, tokens: toolsAppeared },
            noMarker: { events: 0, tokens: noMarker },
          },
          noMarkerDetail: {
            earlyMcp: { events: 0, tokens: 0 },
            other: { events: 0, tokens: 0 },
          },
          depth: depth ?? {
            facade: { events: 0, tokens: 0 },
            d10to50: { events: 1, tokens: prefixChange },
            d50to90: { events: 0, tokens: 0 },
            tail: { events: 0, tokens: 0 },
          },
        },
      },
    },
  } as unknown as Session;
}

const ctx = (sessions: Session[]) => ({ sessions, configItems: [] });

test('R1 fires when prefix-change churn dominates, priced at the session rate', () => {
  const recs = r1.evaluate(ctx([session('s1', { prefixChange: 50000, compaction: 1000, expiration: 2000 })]));
  expect(recs.length).toBe(1);
  const rec = recs[0]!;
  expect(rec.ruleId).toBe('R1');
  expect(rec.subject).toBe('F--proj');
  expect(rec.confidence).toBe('fait');
  expect(rec.costBasis).toBe('jetons-mesures');
  expect(rec.estimatedCostUsd, '50000 tokens at $0.0001/token').toBe(5);
  expect(rec.evidence.sessions).toEqual(['s1']);
  expect(rec.evidence.prefixChangeTokens).toBe(50000);
  expect(rec.evidence.costComplete).toBe(true);
});

test('R1 stays silent when compaction or expiration dominates', () => {
  expect(r1.evaluate(ctx([session('s1', { prefixChange: 10000, compaction: 50000 })]))).toEqual([]);
  expect(r1.evaluate(ctx([session('s1', { prefixChange: 10000, expiration: 50000 })]))).toEqual([]);
});

test('R1 stays silent when dominance is real but trivial against net tokens', () => {
  // Dominant, yet 1 % of the session's net tokens: below the calibrated 20 %.
  expect(r1.evaluate(ctx([session('s1', { prefixChange: 1000, netTokens: 100000 })]))).toEqual([]);
});

test('R1 stays silent when there is no prefix-change churn at all', () => {
  expect(r1.evaluate(ctx([session('s1')]))).toEqual([]);
});

test('R1 emits one recommendation per project, aggregating its sessions', () => {
  const recs = r1.evaluate(ctx([
    session('s1', { prefixChange: 40000, netTokens: 100000 }),
    session('s2', { prefixChange: 10000, netTokens: 40000 }),
    session('s3', { project: 'F--other', prefixChange: 20000, netTokens: 50000 }),
  ]));
  expect(recs.map(r => r.subject).sort()).toEqual(['F--other', 'F--proj']);
  const proj = recs.find(r => r.subject === 'F--proj');
  expect(proj!.evidence.sessions).toEqual(['s1', 's2']);
  expect(proj!.evidence.prefixChangeTokens).toBe(50000);
});

// The calibration measured the share threshold on SESSIONS (1695 of them), not
// on project aggregates: a project-level share would let one heavy session drag
// in quiet ones, and would fire on a different population than the one the
// 20 % was chosen against.
test('the share gate is applied per session, never to the project aggregate', () => {
  const recs = r1.evaluate(ctx([
    session('s1', { prefixChange: 40000, netTokens: 100000 }),  // 40 % — qualifies
    session('s2', { prefixChange: 1000, netTokens: 100000 }),   // 1 %  — does not
  ]));
  // The project aggregate is 41000/200000 = 20,5 %, above the floor: gating on
  // the aggregate would drag s2 in with its 1 %. Gating per session keeps it out.
  expect(recs.length).toBe(1);
  expect(recs[0]!.evidence.sessions).toEqual(['s1']);
  expect(recs[0]!.evidence.prefixChangeTokens).toBe(40000);
});

test('the share is computed on the sessions that fired, not on the whole project', () => {
  // s2 does not fire (compaction dominates); it must not dilute s1's share.
  const recs = r1.evaluate(ctx([
    session('s1', { prefixChange: 20000, netTokens: 100000 }),
    session('s2', { prefixChange: 0, compaction: 90000, netTokens: 900000 }),
  ]));
  expect(recs.length).toBe(1);
  expect(recs[0]!.evidence.sessions).toEqual(['s1']);
});

test('one partially-priced session marks the whole recommendation partial', () => {
  const recs = r1.evaluate(ctx([
    session('s1', { prefixChange: 40000, netTokens: 100000 }),
    session('s2', { prefixChange: 10000, netTokens: 40000, costComplete: false }),
  ]));
  expect(recs[0]!.evidence.costComplete).toBe(false);
});

// The action must follow the marker the engine actually journaled. On the
// 90-day history, the biggest project carries 25,26 M prefix-change tokens with
// modelSwitch at exactly 0: prescribing "start with the right model" there
// recommends a gesture the measurement refutes.
test('the action names the model switch only when that marker dominates', () => {
  const recs = r1.evaluate(ctx([session('s1', { prefixChange: 50000 })]));
  expect(recs[0]!.evidence.dominantMarker).toBe('modelSwitch');
  expect(recs[0]!.action).toMatch(/modèle/);
});

test('when nothing in the journal explains the break, R1 emits no action at all', () => {
  const recs = r1.evaluate(ctx([session('s1', { prefixChange: 50000, noMarker: 50000 })]));
  expect(recs[0]!.evidence.dominantMarker).toBe('noMarker');
  // No text stands in for a gesture the measurement cannot support: a null
  // action is an informative card, not a disguised recommendation.
  expect(recs[0]!.action).toBe(null);
});

test('when deferred tools were loaded mid-session, R1 emits no action either', () => {
  const recs = r1.evaluate(ctx([session('s1', { prefixChange: 50000, toolsAppeared: 50000 })]));
  expect(recs[0]!.evidence.dominantMarker).toBe('toolsAppeared');
  // Official docs: a deferred tool loaded through tool search is APPENDED to the
  // history, the cache is preserved (our controlled test re-read it in full). The
  // marker is a coincidence, not a mechanism: the card stays informative.
  expect(recs[0]!.action).toBe(null);
});

// cache_miss_reason (Claude Code ≥ ~2.1.220) is a first-hand diagnostic: the
// client itself names the block that changed. toolsChanged is the one diagnosed
// marker with an unambiguous documented gesture (official docs: connecting or
// disconnecting an MCP server mid-session rewrites the tools block).
test('when the diagnosed tools_changed marker dominates, the action names the MCP gesture', () => {
  const recs = r1.evaluate(ctx([session('s1', { prefixChange: 50000, toolsChanged: 50000 })]));
  expect(recs[0]!.evidence.dominantMarker).toBe('toolsChanged');
  expect(recs[0]!.action).toMatch(/MCP/);
});

test('a diagnosed system_changed break stays informative: the block is named, the lever is not', () => {
  const recs = r1.evaluate(ctx([session('s1', { prefixChange: 50000, systemChanged: 50000 })]));
  expect(recs[0]!.evidence.dominantMarker).toBe('systemChanged');
  // The diagnostic proves WHAT changed (the system block), never WHICH setting
  // did it (effort, fast mode, upgrade…): prescribing one would be a guess.
  expect(recs[0]!.action).toBe(null);
});

test('a diagnosed messages_changed break stays informative too', () => {
  const recs = r1.evaluate(ctx([session('s1', { prefixChange: 50000, messagesChanged: 50000 })]));
  expect(recs[0]!.evidence.dominantMarker).toBe('messagesChanged');
  expect(recs[0]!.action).toBe(null);
});

// A report scanned before a marker was added lacks its cell, and stays in the DB
// after an upgrade. Throwing there ("Cannot read properties of undefined") made
// the whole R1 card vanish until a re-scan.
test('a report stored by an older engine (missing marker cells) still evaluates, absent cells read zero', () => {
  const s = session('s1', { prefixChange: 50000, noMarker: 50000 });
  const markers = s.report.context.prefixBreakdown.markers as Record<string, unknown>;
  delete markers.systemChanged; delete markers.toolsChanged; delete markers.messagesChanged;
  const recs = r1.evaluate(ctx([s]));
  expect(recs.length).toBe(1);
  expect(recs[0]!.evidence.dominantMarker).toBe('noMarker');
  expect(recs[0]!.evidence.markerTokens.systemChanged).toBe(0);
});

test('dominance is decided on the aggregate of the sessions that fired', () => {
  // s1 alone would read as a model switch; across the project noMarker wins.
  const recs = r1.evaluate(ctx([
    session('s1', { prefixChange: 30000 }),
    session('s2', { prefixChange: 50000, noMarker: 50000 }),
  ]));
  expect(recs[0]!.evidence.dominantMarker).toBe('noMarker');
});

test('the evidence carries every marker, and they sum to the prefix-change tokens', () => {
  const recs = r1.evaluate(ctx([session('s1', { prefixChange: 50000, toolsChanged: 3000, toolsAppeared: 5000, noMarker: 40000 })]));
  const { markerTokens, prefixChangeTokens } = recs[0]!.evidence;
  expect(markerTokens).toEqual({
    modelSwitch: 2000, systemChanged: 0, toolsChanged: 3000, messagesChanged: 0,
    toolsAppeared: 5000, noMarker: 40000,
  });
  const summed = Object.values(markerTokens).reduce((a, b) => a + b, 0);
  expect(summed, 'the engine invariant must survive aggregation').toBe(prefixChangeTokens);
});

// Where the prefix breaks is the only thing left to say when no marker
// explains it — a "we do not know" card with no figure is worse than the bug.
test('the evidence carries where the prefix broke', () => {
  const recs = r1.evaluate(ctx([session('s1', {
    prefixChange: 50000, noMarker: 50000,
    depth: {
      facade: { events: 1, tokens: 10000 },
      d10to50: { events: 1, tokens: 35000 },
      d50to90: { events: 1, tokens: 5000 },
      tail: { events: 0, tokens: 0 },
    },
  })]));
  expect(recs[0]!.evidence.dominantDepth).toBe('d10to50');
  expect(recs[0]!.evidence.depthTokens.facade).toBe(10000);
});

test('R1 evidence carries the noMarkerDetail ventilation in tokens', () => {
  const stat = (events: number, tokens: number) => ({ events, tokens });
  // Qualifying session: prefixChange dominant (40000 >= compaction and expiration)
  // and 40% of net (R1 threshold: 20%). The noMarker bucket splits 30000 / 10000.
  const session = {
    id: 'sess-early', project: 'F--dvf', netTokens: 100000, costUsd: 1, costComplete: true,
    report: { context: {
      churnCauses: {
        prefixChange: stat(1, 40000), compaction: stat(0, 0), expiration: stat(0, 0),
        growth: stat(0, 0), unknown: stat(0, 0),
      },
      prefixBreakdown: {
        markers: {
          modelSwitch: stat(0, 0), systemChanged: stat(0, 0), toolsChanged: stat(0, 0),
          messagesChanged: stat(0, 0), toolsAppeared: stat(0, 0), noMarker: stat(1, 40000),
        },
        noMarkerDetail: { earlyMcp: stat(2, 30000), other: stat(1, 10000) },
        depth: { facade: stat(1, 40000), d10to50: stat(0, 0), d50to90: stat(0, 0), tail: stat(0, 0) },
      },
    } },
  };
  const recs = r1.evaluate({ sessions: [session as unknown as Session], configItems: [] });
  expect(recs.length).toBe(1);
  expect(recs[0]!.evidence.noMarkerDetailTokens).toEqual({ earlyMcp: 30000, other: 10000 });
});

test('the registry exposes R1 and evaluateAll routes through it', () => {
  expect(RULES.some(r => r.id === 'R1')).toBeTruthy();
  expect(evaluateAll(ctx([session('s1', { prefixChange: 50000 })])).map(r => r.ruleId)).toEqual(['R1']);
});

test('a rule that throws never takes the whole evaluation down', () => {
  const boom = { id: 'RX', category: 'test', evaluate() { throw new Error('bug'); } } as unknown as Rule;
  const recs = evaluateAll(ctx([session('s1', { prefixChange: 50000 })]), [boom, r1]);
  expect(recs.map(r => r.ruleId)).toEqual(['R1']);
});

'use strict';
// R6 — subagents on tasks too short to need them.
//
// The only correlation-grade rule of M1: a short session with heavy subagent
// spend may be misuse, or may be parallelism that worked. The ranking weights
// it at 0.6 instead of pretending it is a fact.
//
// Needs the session duration, which is why netgain v0.11.0 exposes endedAt. A
// session without timestamps cannot be judged and is left out entirely — it is
// never counted as a zero-length session.

import { COST_BASIS, sumUsd } from './cost.js';
import { THRESHOLDS } from './thresholds.js';
import { netOf } from '../session-mapper.js';

const ID = 'R6';
const CATEGORY = 'sous-agents';

// tokens.perAgent contains subagent buckets only — the main agent has its own
// tokens.main bucket. Pinned by the engine contract test, so there is nothing
// to filter out here.
function subagentNetTokens(report) {
  return Object.values(report.tokens.perAgent).reduce((acc, bucket) => acc + netOf(bucket), 0);
}

function durationMs(session) {
  if (session.startedAt === null || session.endedAt === null) return null;
  const ms = Date.parse(session.endedAt) - Date.parse(session.startedAt);
  return Number.isNaN(ms) ? null : ms;
}

// Median, not mean: one outlier session must not move the reported figure.
function medianOf(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function evaluate(ctx) {
  const byProject = new Map();
  for (const session of ctx.sessions) {
    if (session.report.subagents.spawnToolUses === 0) continue;
    const ms = durationMs(session);
    if (ms === null || ms >= THRESHOLDS.R6.maxDurationMs) continue;
    const subTokens = subagentNetTokens(session.report);
    if (!session.netTokens) continue;
    if (subTokens / session.netTokens <= THRESHOLDS.R6.minSubagentShare) continue;

    const agg = byProject.get(session.project)
      ?? { sessions: [], pairs: [], subTokens: 0, spawns: 0, durationsMs: [], costComplete: true };
    agg.sessions.push(session.id);
    agg.pairs.push([session, subTokens]);
    agg.subTokens += subTokens;
    agg.spawns += session.report.subagents.spawnToolUses;
    agg.durationsMs.push(ms);
    agg.costComplete = agg.costComplete && session.costComplete;
    byProject.set(session.project, agg);
  }

  const recs = [];
  for (const [project, agg] of byProject) {
    recs.push({
      ruleId: ID,
      subject: project,
      title: 'Sous-agents lancés sur des tâches courtes',
      category: CATEGORY,
      confidence: 'correlation',
      estimatedCostUsd: sumUsd(agg.pairs),
      costBasis: COST_BASIS.MEASURED_TOKENS,
      evidence: {
        sessions: agg.sessions,
        subagentTokens: agg.subTokens,
        spawns: agg.spawns,
        medianDurationSeconds: Math.round(medianOf(agg.durationsMs) / 1000),
        costComplete: agg.costComplete,
      },
      action: 'Traiter les tâches courtes en direct ; réserver les sous-agents au vrai parallélisme.',
    });
  }
  return recs;
}

const subjectKind = 'project';

export { ID as id, CATEGORY as category, subjectKind, evaluate };

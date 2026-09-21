'use strict';
// Per-skill usage and attributed cost for the « Skills » panel — the twin of
// model-costs.ts. A skill that served was available: offered is the union of
// listed, called and attributed. Dollars come from report.tokens.costBySkill.

import { netOf } from './session-mapper.ts';
import type { Session, SkillCost, SkillFacts, TokenBucket } from './rules/types.ts';

type SkillSession = Session & {
  report: Session['report'] & {
    skills: SkillFacts;
    tokens: Session['report']['tokens'] & { costBySkill: Record<string, SkillCost> };
  };
};
const hasSkills = (s: Session): s is SkillSession =>
  s.report.skills !== undefined && s.report.tokens.costBySkill !== undefined;

interface SkillAgg {
  skill: string;
  offeredSessions: number;
  usedSessions: number;
  calls: number;
  bucket: TokenBucket;
  usd: number | null;
}

interface SkillUsageRow {
  skill: string;
  offeredSessions: number;
  usedSessions: number;
  usedShare: number;
  calls: number;
  netTokens: number;
  usd: number | null;
  shareOfCost: number | null;
}

interface SkillUsageResult {
  skills: SkillUsageRow[];
  sessionsCounted: number;
  excludedPendingRescan: number;
}

const emptyBucket = (): TokenBucket =>
  ({ in: 0, out: 0, cacheCreate: 0, cacheRead: 0, cacheCreate1h: 0, cacheCreate5m: 0 });

function aggregate(sessions: SkillSession[]): SkillAgg[] {
  const bySkill = new Map<string, SkillAgg>();
  for (const s of sessions) {
    const { listed, calls } = s.report.skills;
    const cost = s.report.tokens.costBySkill;
    const used = new Set([...Object.keys(calls), ...Object.keys(cost)]);
    for (const skill of new Set([...listed, ...used])) {
      let agg = bySkill.get(skill);
      if (!agg) {
        agg = { skill, offeredSessions: 0, usedSessions: 0, calls: 0, bucket: emptyBucket(), usd: 0 };
        bySkill.set(skill, agg);
      }
      agg.offeredSessions += 1;
      if (used.has(skill)) agg.usedSessions += 1;
      agg.calls += calls[skill] ?? 0;
      const c = cost[skill];
      if (c) {
        for (const k of Object.keys(agg.bucket) as (keyof TokenBucket)[]) agg.bucket[k] += c.tokens[k];
        agg.usd = agg.usd === null || c.usd === null ? null : agg.usd + c.usd;
      }
    }
  }
  return [...bySkill.values()];
}

const byName = (a: { skill: string }, b: { skill: string }) => a.skill.localeCompare(b.skill);

function computeSkillUsage(sessions: Session[]): SkillUsageResult {
  const ready = sessions.filter(hasSkills);
  const totalCost = ready.reduce((acc, s) => acc + s.costUsd, 0);
  const aggs = aggregate(ready);

  const rows: SkillUsageRow[] = aggs.map(a => ({
    skill: a.skill,
    offeredSessions: a.offeredSessions,
    usedSessions: a.usedSessions,
    usedShare: a.usedSessions / a.offeredSessions,
    calls: a.calls,
    netTokens: netOf(a.bucket),
    usd: a.usd,
    // An unknown tariff has no cost share — null, never a fake 0.
    shareOfCost: a.usd !== null && totalCost > 0 ? a.usd / totalCost : null,
  }));
  // The panel reads as a usage ranking, unused skills included: at equal share
  // the skill seen in more sessions weighs more — for the 0 % rows, the most offered.
  rows.sort((a, b) => b.usedShare - a.usedShare || b.usedSessions - a.usedSessions
    || b.offeredSessions - a.offeredSessions || byName(a, b));

  return {
    skills: rows,
    sessionsCounted: ready.length,
    excludedPendingRescan: sessions.length - ready.length,
  };
}

export { computeSkillUsage };
export type { SkillUsageRow, SkillUsageResult };

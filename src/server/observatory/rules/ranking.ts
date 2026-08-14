'use strict';
// Ranking of recommendations. Business logic, therefore server-side and
// testable without a DOM: the advisor page renders what it is handed.
//
// The homogeneity rule, as code:
//
// * One ranked list PER COST BASIS. Dollars derived from measured tokens and
//   dollars derived from a 4-bytes-per-token conversion do not carry the same
//   precision, so they are never ordered against each other.
// * NO total, anywhere. A same session feeds several rules (R1 and R5 can both
//   charge it), so summing recommendation costs would double-count. There is
//   deliberately no sum function in this module.
// * A recommendation the latest scan did not re-emit leaves the ranking and is
//   reported as "no longer occurring" — a fact, not a claim that anything the
//   user did caused it (effect measurement is M3).

import { COST_BASIS } from './cost.ts';

// The persisted shape: a draft Recommendation (rules/types.ts) once the
// service layer has given it an id and a lifecycle. Local to this file —
// nothing else in the lot needs the persisted fields (id, status,
// costAtStatusUsd, the timestamps), so it stays out of the shared types.ts.
interface RankedRecommendation {
  id: number;
  ruleId: string;
  subject: string;
  title: string;
  category: string;
  confidence: string;
  estimatedCostUsd: number;
  costBasis: string;
  evidence: Record<string, unknown>;
  action: string | null;
  status: 'new' | 'accepted' | 'ignored';
  costAtStatusUsd: number | null;
  createdAt: string;
  updatedAt: string;
  lastSeenAt: string | null;
}

const CONFIDENCE_WEIGHT: Record<string, number> = { fait: 1, correlation: 0.6, hypothese: 0.3 };
const IGNORED_RETURN_FACTOR = 1.5;
const PRIORITY_SIZE = 3;
const BASIS_ORDER: string[] = [COST_BASIS.MEASURED_TOKENS, COST_BASIS.APPROX_BYTES];

function scoreOf(rec: RankedRecommendation): number {
  return rec.estimatedCostUsd * (CONFIDENCE_WEIGHT[rec.confidence] ?? 0);
}

// 'new' is always proposed; 'accepted' never is again; 'ignored' comes back
// only once its recomputed cost has grown by at least 50 % since the user
// dismissed it. A missing baseline is not a reason to guess — it stays out.
function isEligible(rec: RankedRecommendation): boolean {
  if (rec.status === 'accepted') return false;
  if (rec.status === 'ignored') {
    if (typeof rec.costAtStatusUsd !== 'number') return false;
    return rec.estimatedCostUsd >= rec.costAtStatusUsd * IGNORED_RETURN_FACTOR;
  }
  return true;
}

function isStale(rec: RankedRecommendation, lastScanAt: string | null): boolean {
  if (!lastScanAt) return false;
  if (!rec.lastSeenAt) return true;
  return rec.lastSeenAt < lastScanAt;
}

interface RankGroup {
  basis: string;
  priority: RankedRecommendation[];
  all: RankedRecommendation[];
}

function rankByBasis(
  recs: RankedRecommendation[], { lastScanAt }: { lastScanAt: string | null },
): { groups: RankGroup[]; stale: RankedRecommendation[] } {
  const stale: RankedRecommendation[] = [];
  const current: RankedRecommendation[] = [];
  for (const rec of recs) (isStale(rec, lastScanAt) ? stale : current).push(rec);

  const groups: RankGroup[] = [];
  for (const basis of BASIS_ORDER) {
    const all = current
      .filter(r => r.costBasis === basis)
      .sort((a, b) => scoreOf(b) - scoreOf(a) || a.id - b.id);
    if (all.length === 0) continue;
    groups.push({ basis, priority: all.filter(isEligible).slice(0, PRIORITY_SIZE), all });
  }
  return { groups, stale };
}

export {
  CONFIDENCE_WEIGHT, IGNORED_RETURN_FACTOR, PRIORITY_SIZE, BASIS_ORDER,
  scoreOf, isEligible, isStale, rankByBasis,
};

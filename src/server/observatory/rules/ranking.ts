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
// * A DECIDED recommendation (accepted, ignored, arbitrated) lives in the
//   journal, not in the groups (doc/44): the decision wins over freshness,
//   and only the +50 % return rule can surface it again — never arbitrated.

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
  status: 'new' | 'accepted' | 'ignored' | 'arbitrated';
  costAtStatusUsd: number | null;
  statusReason: string | null;
  statusAt: string | null;
  createdAt: string;
  updatedAt: string;
  lastSeenAt: string | null;
}

const CONFIDENCE_WEIGHT: Record<string, number> = { fait: 1, correlation: 0.6, hypothese: 0.3 };
const RETURN_FACTOR = 1.5;
const PRIORITY_SIZE = 3;
const BASIS_ORDER: string[] = [COST_BASIS.MEASURED_TOKENS, COST_BASIS.APPROX_BYTES];

function scoreOf(rec: RankedRecommendation): number {
  return rec.estimatedCostUsd * (CONFIDENCE_WEIGHT[rec.confidence] ?? 0);
}

// 'new' is always proposed; 'accepted' and 'ignored' come back only once the
// recomputed cost has grown by at least 50 % since the user decided (doc/44 —
// an adoption is a watched commitment, not a pledge taken on faith). A missing
// baseline is not a reason to guess — the card stays in the journal.
// 'arbitrated' never comes back on its own (doc/42): the user already weighed
// this exact choice, only lifting the arbitration re-proposes it — its frozen
// costAtStatusUsd is kept for a FUTURE resurfacing rule, none exists yet.
function isEligible(rec: RankedRecommendation): boolean {
  if (rec.status === 'arbitrated') return false;
  if (rec.status === 'accepted' || rec.status === 'ignored') {
    if (typeof rec.costAtStatusUsd !== 'number') return false;
    return rec.estimatedCostUsd >= rec.costAtStatusUsd * RETURN_FACTOR;
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
): { groups: RankGroup[]; stale: RankedRecommendation[]; decided: RankedRecommendation[] } {
  // The decision wins over freshness: a card the user has already ruled on
  // stays a readable journal line even when the scan no longer emits it —
  // most recent decision first. Only a card past its return threshold leaves
  // the journal, and it re-enters the normal ranking with its status intact:
  // the page needs the status to pick the right return banner.
  const decided = recs
    .filter(r => r.status !== 'new' && !isEligible(r))
    .sort((a, b) => (b.statusAt ?? '').localeCompare(a.statusAt ?? '') || a.id - b.id);

  const stale: RankedRecommendation[] = [];
  const current: RankedRecommendation[] = [];
  for (const rec of recs.filter(r => r.status === 'new' || isEligible(r))) {
    (isStale(rec, lastScanAt) ? stale : current).push(rec);
  }

  const groups: RankGroup[] = [];
  for (const basis of BASIS_ORDER) {
    const all = current
      .filter(r => r.costBasis === basis)
      .sort((a, b) => scoreOf(b) - scoreOf(a) || a.id - b.id);
    if (all.length === 0) continue;
    // Everything that reaches a group is eligible by construction; priority
    // is only the size cut.
    groups.push({ basis, priority: all.slice(0, PRIORITY_SIZE), all });
  }
  return { groups, stale, decided };
}

export {
  CONFIDENCE_WEIGHT, RETURN_FACTOR, PRIORITY_SIZE, BASIS_ORDER,
  scoreOf, isEligible, isStale, rankByBasis,
};

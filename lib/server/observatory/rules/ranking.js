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

const { COST_BASIS } = require('./cost');

const CONFIDENCE_WEIGHT = { fait: 1, correlation: 0.6, hypothese: 0.3 };
const IGNORED_RETURN_FACTOR = 1.5;
const PRIORITY_SIZE = 3;
const BASIS_ORDER = [COST_BASIS.MEASURED_TOKENS, COST_BASIS.APPROX_BYTES];

function scoreOf(rec) {
  return rec.estimatedCostUsd * (CONFIDENCE_WEIGHT[rec.confidence] ?? 0);
}

// 'new' is always proposed; 'accepted' never is again; 'ignored' comes back
// only once its recomputed cost has grown by at least 50 % since the user
// dismissed it. A missing baseline is not a reason to guess — it stays out.
function isEligible(rec) {
  if (rec.status === 'accepted') return false;
  if (rec.status === 'ignored') {
    if (typeof rec.costAtStatusUsd !== 'number') return false;
    return rec.estimatedCostUsd >= rec.costAtStatusUsd * IGNORED_RETURN_FACTOR;
  }
  return true;
}

function isStale(rec, lastScanAt) {
  if (!lastScanAt) return false;
  if (!rec.lastSeenAt) return true;
  return rec.lastSeenAt < lastScanAt;
}

function rankByBasis(recs, { lastScanAt }) {
  const stale = [];
  const current = [];
  for (const rec of recs) (isStale(rec, lastScanAt) ? stale : current).push(rec);

  const groups = [];
  for (const basis of BASIS_ORDER) {
    const all = current
      .filter(r => r.costBasis === basis)
      .sort((a, b) => scoreOf(b) - scoreOf(a) || a.id - b.id);
    if (all.length === 0) continue;
    groups.push({ basis, priority: all.filter(isEligible).slice(0, PRIORITY_SIZE), all });
  }
  return { groups, stale };
}

module.exports = {
  CONFIDENCE_WEIGHT, IGNORED_RETURN_FACTOR, PRIORITY_SIZE, BASIS_ORDER,
  scoreOf, isEligible, isStale, rankByBasis,
};

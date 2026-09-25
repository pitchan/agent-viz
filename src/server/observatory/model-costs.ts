'use strict';
// Per-model totals for the « Jetons & tarifs » panel — the twin of summary.ts:
// window totals, nothing else. Dollars come from the engine's per-message
// accumulation (report.tokens.costByModel), NEVER recomputed from token
// buckets: recomputing would lose the dated tariff and the 5min/1h cache
// split of each message. Sessions stored before SCAN_VERSION 6 (costByModel)
// or SCAN_VERSION 14 (fastUsd on every entry) are excluded from BOTH the rows
// and the totals — never silently, the count travels in the result — so
// "sum of rows = total" stays true for what is displayed.

import { netOf } from './session-mapper.ts';
import type { Session, TokenBucket } from './rules/types.ts';

const emptyBucket = (): TokenBucket =>
  ({ in: 0, out: 0, cacheCreate: 0, cacheRead: 0, cacheCreate1h: 0, cacheCreate5m: 0 });

// costByModel is the SCAN_VERSION 6 field, fastUsd on every entry the
// SCAN_VERSION 14 one (rules/types.ts): a session stored before either lacks
// it. A real `v is X` guard, not a cast — the filtered array below is used
// to read both, so the narrowing must actually hold.
type PricedSession = Session & {
  report: Session['report'] & {
    tokens: Session['report']['tokens'] & {
      costByModel: Record<string, { usd: number | null; fastUsd: number; pricing: string }>;
    };
  };
};
const isPriced = (s: Session): s is PricedSession => {
  const { costByModel } = s.report.tokens;
  return costByModel !== undefined && Object.values(costByModel).every(mc => typeof mc.fastUsd === 'number');
};

interface ModelAgg {
  model: string;
  bucket: TokenBucket;
  costUsd: number | null;
  fastUsd: number;
  pricing: string;
  sessions: number;
}

interface ModelCostRow extends ModelAgg {
  netTokens: number;
  shareOfNet: number;
  shareOfCost: number | null;
}

interface ModelCostsTotals {
  netTokens: number;
  costUsd: number;
  fastUsd: number;
  costComplete: boolean;
  cacheReadTokens: number;
}

interface ModelCostsResult {
  models: ModelCostRow[];
  totals: ModelCostsTotals;
  unknownModels: string[];
  excludedPendingRescan: number;
}

function computeModelCosts(sessions: Session[]): ModelCostsResult {
  const ready = sessions.filter(isPriced);

  const byModel = new Map<string, ModelAgg>();
  for (const s of ready) {
    const { perModel, costByModel } = s.report.tokens;
    for (const [model, mc] of Object.entries(costByModel)) {
      let agg = byModel.get(model);
      if (!agg) {
        agg = { model, bucket: emptyBucket(), costUsd: null, fastUsd: 0, pricing: mc.pricing, sessions: 0 };
        byModel.set(model, agg);
      }
      const b = perModel[model];
      if (b) for (const k of Object.keys(agg.bucket) as (keyof TokenBucket)[]) agg.bucket[k] += b[k] ?? 0;
      if (mc.usd !== null) agg.costUsd = (agg.costUsd ?? 0) + mc.usd;
      agg.fastUsd += mc.fastUsd;
      // Une seule session au tarif inconnu fait du montant de la ligne une borne basse.
      if (mc.pricing === 'inconnu') agg.pricing = 'inconnu';
      agg.sessions += 1;
    }
  }

  const totals: ModelCostsTotals = {
    netTokens: ready.reduce((acc, s) => acc + s.netTokens, 0),
    costUsd: ready.reduce((acc, s) => acc + s.costUsd, 0),
    fastUsd: [...byModel.values()].reduce((acc, agg) => acc + agg.fastUsd, 0),
    costComplete: ready.every(s => s.costComplete),
    cacheReadTokens: ready.reduce((acc, s) => acc + s.report.tokens.total.cacheRead, 0),
  };

  const rows: ModelCostRow[] = [...byModel.values()].map(agg => ({
    ...agg,
    netTokens: netOf(agg.bucket),
    shareOfNet: totals.netTokens > 0 ? netOf(agg.bucket) / totals.netTokens : 0,
    // A model without a known tariff, or whose dollars are only a partial sum
    // (pricing 'inconnu'), has no cost share — null, never a fake or partial one.
    shareOfCost: agg.costUsd !== null && agg.pricing !== 'inconnu' && totals.costUsd > 0
      ? agg.costUsd / totals.costUsd : null,
  }));

  // Priced models by descending dollars; models with no known tariff, or whose
  // costUsd is only a partial sum ('inconnu'), LAST by descending net tokens —
  // visible, never ranked as if the amount were complete.
  const hasCost = (r: ModelCostRow): r is ModelCostRow & { costUsd: number } =>
    r.costUsd !== null && r.pricing !== 'inconnu';
  const priced = rows.filter(hasCost).sort((a, b) => b.costUsd - a.costUsd);
  const unpriced = rows.filter(r => !hasCost(r)).sort((a, b) => b.netTokens - a.netTokens);

  return {
    models: [...priced, ...unpriced],
    totals,
    unknownModels: [...new Set(ready.flatMap(s => s.report.tokens.unknownModels))].sort(),
    excludedPendingRescan: sessions.length - ready.length,
  };
}

// Les modèles qu'au moins une session a appelés, sous l'id normalisé que porte le
// barème : le panneau Tarifs ne parle que de ceux-là.
function modelsSeen(sessions: Session[]): Set<string> {
  return new Set(sessions.flatMap(s => Object.keys(s.report.tokens.perModel)));
}

export { computeModelCosts, modelsSeen };

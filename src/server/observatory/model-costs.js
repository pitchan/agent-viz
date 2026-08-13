'use strict';
// Per-model totals for the « Jetons & tarifs » panel — the twin of summary.js:
// window totals, nothing else. Dollars come from the engine's per-message
// accumulation (report.tokens.costByModel), NEVER recomputed from token
// buckets: recomputing would lose the dated tariff and the 5min/1h cache
// split of each message. Sessions stored before SCAN_VERSION 6 lack
// costByModel and are excluded from BOTH the rows and the totals — never
// silently, the count travels in the result — so "sum of rows = total" stays
// true for what is displayed.

import { netOf } from './session-mapper.js';

const emptyBucket = () =>
  ({ in: 0, out: 0, cacheCreate: 0, cacheRead: 0, cacheCreate1h: 0, cacheCreate5m: 0 });

function computeModelCosts(sessions) {
  const ready = sessions.filter(s => s.report.tokens.costByModel !== undefined);

  const byModel = new Map();
  for (const s of ready) {
    const { perModel, costByModel } = s.report.tokens;
    for (const [model, mc] of Object.entries(costByModel)) {
      let agg = byModel.get(model);
      if (!agg) {
        agg = { model, bucket: emptyBucket(), costUsd: null, pricing: mc.pricing, sessions: 0 };
        byModel.set(model, agg);
      }
      const b = perModel[model];
      if (b) for (const k of Object.keys(agg.bucket)) agg.bucket[k] += b[k] ?? 0;
      if (mc.usd !== null) agg.costUsd = (agg.costUsd ?? 0) + mc.usd;
      agg.sessions += 1;
    }
  }

  const totals = {
    netTokens: ready.reduce((acc, s) => acc + s.netTokens, 0),
    costUsd: ready.reduce((acc, s) => acc + s.costUsd, 0),
    costComplete: ready.every(s => s.costComplete),
    cacheReadTokens: ready.reduce((acc, s) => acc + s.report.tokens.total.cacheRead, 0),
  };

  const rows = [...byModel.values()].map(agg => ({
    ...agg,
    netTokens: netOf(agg.bucket),
    shareOfNet: totals.netTokens > 0 ? netOf(agg.bucket) / totals.netTokens : 0,
    // A model without a known tariff has no cost share — null, never a fake 0.
    shareOfCost: agg.costUsd !== null && totals.costUsd > 0 ? agg.costUsd / totals.costUsd : null,
  }));

  // Priced models by descending dollars; models with no known tariff LAST,
  // by descending net tokens — visible, never hidden.
  const priced = rows.filter(r => r.costUsd !== null).sort((a, b) => b.costUsd - a.costUsd);
  const unpriced = rows.filter(r => r.costUsd === null).sort((a, b) => b.netTokens - a.netTokens);

  return {
    models: [...priced, ...unpriced],
    totals,
    unknownModels: [...new Set(ready.flatMap(s => s.report.tokens.unknownModels))].sort(),
    excludedPendingRescan: sessions.length - ready.length,
  };
}

export { computeModelCosts };

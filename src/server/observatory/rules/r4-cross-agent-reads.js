'use strict';
// R4 — the same file is read by several agents.
//
// The J8 investigation closed every other re-read hypothesis (identical
// intra-agent re-reads: 0.08 %) and left exactly one real seam: cross-agent
// duplicates, ~7 % of read volume. The share threshold sits just under that
// known-real case; the absolute floor only matters on tiny histories, where a
// percentage of almost nothing would still fire. On the 90-day relevé that
// floor is what does the sorting — it takes 84 sessions down to 7.

import { COST_BASIS, usdForBytes } from './cost.js';
import { THRESHOLDS } from './thresholds.js';

const ID = 'R4';
const CATEGORY = 'sous-agents';

function evaluate(ctx) {
  const byProject = new Map();
  for (const session of ctx.sessions) {
    const dup = session.report.reads.cases.crossAgentDuplicate;
    if (dup.bytes === 0) continue;
    const agg = byProject.get(session.project)
      ?? { bytes: 0, count: 0, totalBytes: 0, sessions: [], usd: 0, costComplete: true };
    agg.bytes += dup.bytes;
    agg.count += dup.count;
    agg.totalBytes += session.report.reads.totalBytes;
    agg.usd += usdForBytes(session, dup.bytes);
    agg.costComplete = agg.costComplete && session.costComplete;
    agg.sessions.push(session.id);
    byProject.set(session.project, agg);
  }

  const recs = [];
  for (const [project, agg] of byProject) {
    if (agg.bytes < THRESHOLDS.R4.minBytes) continue;
    const share = agg.totalBytes ? agg.bytes / agg.totalBytes : 0;
    if (share < THRESHOLDS.R4.minShareOfReadBytes) continue;
    recs.push({
      ruleId: ID,
      subject: project,
      title: 'Fichiers relus par plusieurs agents',
      category: CATEGORY,
      confidence: 'fait',
      estimatedCostUsd: agg.usd,
      costBasis: COST_BASIS.APPROX_BYTES,
      evidence: {
        sessions: agg.sessions,
        duplicateBytes: agg.bytes,
        duplicateCount: agg.count,
        readBytes: agg.totalBytes,
        shareOfReadBytesPercent: share * 100,
        costComplete: agg.costComplete,
      },
      action: 'Passer le contenu déjà lu au sous-agent dans sa consigne, plutôt que le laisser relire le fichier.',
    });
  }
  return recs;
}

const subjectKind = 'project';

export { ID as id, CATEGORY as category, subjectKind, evaluate };

'use strict';
// R5 — the session was compacted more than once.
//
// Each compaction re-processes the whole conversation prefix. preTokens is
// that measured volume, so the cost here is real tokens. A compaction whose
// preTokens is unknown is counted separately rather than silently treated as
// free — a missing value is not a zero.

const { COST_BASIS, sumUsd } = require('./cost');
const { THRESHOLDS } = require('./thresholds');

const ID = 'R5';
const CATEGORY = 'contexte';

function evaluate(ctx) {
  const byProject = new Map();
  for (const session of ctx.sessions) {
    const compactions = session.report.context.compactions;
    if (compactions.length < THRESHOLDS.R5.minCompactions) continue;
    const known = compactions.filter(c => typeof c.preTokens === 'number');
    const tokens = known.reduce((acc, c) => acc + c.preTokens, 0);
    const agg = byProject.get(session.project)
      ?? { compactions: 0, unknown: 0, tokens: 0, sessions: [], pairs: [], costComplete: true };
    agg.compactions += compactions.length;
    agg.unknown += compactions.length - known.length;
    agg.tokens += tokens;
    agg.pairs.push([session, tokens]);
    agg.sessions.push(session.id);
    agg.costComplete = agg.costComplete && session.costComplete;
    byProject.set(session.project, agg);
  }

  const recs = [];
  for (const [project, agg] of byProject) {
    recs.push({
      ruleId: ID,
      subject: project,
      title: `Sessions compactées plusieurs fois — projet ${project}`,
      category: CATEGORY,
      confidence: 'fait',
      estimatedCostUsd: sumUsd(agg.pairs),
      costBasis: COST_BASIS.MEASURED_TOKENS,
      evidence: {
        sessions: agg.sessions,
        compactions: agg.compactions,
        compactionsWithoutTokenCount: agg.unknown,
        reprocessedTokens: agg.tokens,
        costComplete: agg.costComplete,
      },
      action: 'Découper le travail en sessions plus courtes, ou ouvrir une nouvelle session plutôt que compacter tard.',
    });
  }
  return recs;
}

module.exports = { id: ID, category: CATEGORY, evaluate };

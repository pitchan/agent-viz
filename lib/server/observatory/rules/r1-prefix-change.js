'use strict';
// R1 — the model was switched mid-session, or the prefix was otherwise rebuilt.
//
// Grounded in the netgain v0.8.0 / v0.9.0 verdict: when prefix-change churn
// outweighs both compaction and expiration churn, the cache prefix is being
// re-created for a reason the user controls.
//
// Both gates are per session, which is how the 90-day calibration measured
// them: the "dominant" gate does the real sorting (1695 sessions down to 284),
// and the 20 % floor only trims the tail so a dominant-but-trivial case cannot
// fire. Qualifying sessions are then grouped by project for display, since a
// project is where a model choice is made.

const { COST_BASIS, sumUsd } = require('./cost');
const { THRESHOLDS } = require('./thresholds');

const ID = 'R1';
const CATEGORY = 'modele';

const prefixTokensOf = report => report.context.churnCauses.prefixChange.tokens;

function qualifies(session) {
  const causes = session.report.context.churnCauses;
  const prefix = causes.prefixChange.tokens;
  if (prefix === 0) return false;
  if (prefix < causes.compaction.tokens || prefix < causes.expiration.tokens) return false;
  if (!session.netTokens) return false;
  return prefix / session.netTokens >= THRESHOLDS.R1.minShareOfNet;
}

function evaluate(ctx) {
  const byProject = new Map();
  for (const session of ctx.sessions) {
    if (!qualifies(session)) continue;
    const list = byProject.get(session.project) ?? [];
    list.push(session);
    byProject.set(session.project, list);
  }

  const recs = [];
  for (const [project, sessions] of byProject) {
    const tokens = sessions.reduce((acc, s) => acc + prefixTokensOf(s.report), 0);
    // Reported share covers the sessions that qualified: a quiet session
    // elsewhere in the project must not dilute a real problem.
    const net = sessions.reduce((acc, s) => acc + s.netTokens, 0);

    recs.push({
      ruleId: ID,
      subject: project,
      title: `Préfixe de cache reconstruit en cours de session — projet ${project}`,
      category: CATEGORY,
      confidence: 'fait',
      estimatedCostUsd: sumUsd(sessions.map(s => [s, prefixTokensOf(s.report)])),
      costBasis: COST_BASIS.MEASURED_TOKENS,
      evidence: {
        sessions: sessions.map(s => s.id),
        prefixChangeTokens: tokens,
        modelSwitchTokens: sessions.reduce(
          (acc, s) => acc + s.report.context.prefixBreakdown.markers.modelSwitch.tokens, 0),
        shareOfNetPercent: (tokens / net) * 100,
        costComplete: sessions.every(s => s.costComplete),
      },
      action: 'Démarrer la session avec le bon modèle, ou ouvrir une nouvelle session avant d’en changer.',
    });
  }
  return recs;
}

module.exports = { id: ID, category: CATEGORY, evaluate };

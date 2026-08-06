'use strict';
// R1 — the cache prefix was rebuilt mid-session.
//
// Grounded in the netgain v0.8.0 / v0.9.0 verdict: when prefix-change churn
// outweighs both compaction and expiration churn, the cache prefix is being
// re-created for a reason worth surfacing.
//
// What the rule measures is the COST; what the engine journals is the MARKER.
// The two are separate and the action follows the marker, never the rule name:
// on the 90-day history the largest project carries 25,26 M prefix-change
// tokens with modelSwitch at exactly 0 (verified against the raw transcripts —
// 0 of its 714 sessions ever holds two models). Prescribing "start with the
// right model" there would name a cause the measurement refutes.
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

const MARKERS = ['modelSwitch', 'toolsAppeared', 'noMarker'];
const DEPTHS = ['facade', 'd10to50', 'd50to90', 'tail'];

// One action per journaled marker, declarative so that a new marker in the
// engine is an entry here rather than a branch in the emission logic. Only
// `modelSwitch` carries a gesture: it is the one marker with a proven
// mechanism (caches are model-scoped — two models, two cache spaces).
const ACTION_BY_MARKER = Object.freeze({
  modelSwitch: 'Démarrer la session avec le bon modèle, ou ouvrir une nouvelle session avant d’en changer.',
  // toolsAppeared: corrected 2026-08-05. The former action ("load deferred
  // tools up front — each mid-session load rewrites the tools block") named a
  // mechanism the official docs refute: tool search APPENDS the discovered
  // definition to the conversation history, the prefix is untouched, the
  // cache is preserved ("adding tools dynamically through tool search does
  // not break your cache"). Our own controlled test agreed (+265 tk, full
  // cache re-read — doc/10, condition C). The marker remains a true temporal
  // observation (a ToolSearch call happened, then a break), but with no
  // established mechanism there is no honest gesture to prescribe.
  toolsAppeared: null,
  // noMarker: the engine found nothing that explains the break, and inventing
  // a remedy is what this rule once got wrong. A null action = informative
  // card: the page shows the facts and offers no gesture to apply.
  noMarker: null,
});

const prefixTokensOf = report => report.context.churnCauses.prefixChange.tokens;

/** Somme d'une découpe du prefixBreakdown sur les sessions retenues. */
const sumBreakdown = (sessions, part, keys) => Object.fromEntries(keys.map(
  key => [key, sessions.reduce((acc, s) => acc + s.report.context.prefixBreakdown[part][key].tokens, 0)]));

/** Clé la plus lourde ; à égalité, la première de `keys` — l'ordre est le départage. */
const dominantOf = (totals, keys) => keys.reduce((best, key) => (totals[key] > totals[best] ? key : best));

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
    const markerTokens = sumBreakdown(sessions, 'markers', MARKERS);
    const noMarkerDetailTokens = sumBreakdown(sessions, 'noMarkerDetail', ['earlyMcp', 'other']);
    const depthTokens = sumBreakdown(sessions, 'depth', DEPTHS);
    // Decided on the aggregate, because the recommendation is per project: a
    // single session reading as a model switch must not speak for the rest.
    const dominantMarker = dominantOf(markerTokens, MARKERS);

    recs.push({
      ruleId: ID,
      subject: project,
      title: 'Préfixe de cache reconstruit en cours de session',
      category: CATEGORY,
      confidence: 'fait',
      estimatedCostUsd: sumUsd(sessions.map(s => [s, prefixTokensOf(s.report)])),
      costBasis: COST_BASIS.MEASURED_TOKENS,
      evidence: {
        sessions: sessions.map(s => s.id),
        prefixChangeTokens: tokens,
        markerTokens,
        noMarkerDetailTokens,
        dominantMarker,
        // Where the prefix broke is the only thing left to say when no marker
        // explains it: a "cause unknown" card with no figure is worth nothing.
        depthTokens,
        dominantDepth: dominantOf(depthTokens, DEPTHS),
        shareOfNetPercent: (tokens / net) * 100,
        costComplete: sessions.every(s => s.costComplete),
      },
      action: ACTION_BY_MARKER[dominantMarker],
    });
  }
  return recs;
}

module.exports = { id: ID, category: CATEGORY, subjectKind: 'project', evaluate };

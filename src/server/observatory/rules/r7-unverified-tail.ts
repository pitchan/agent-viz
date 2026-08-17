'use strict';
// R7 — travail terminé sans vérification (doc/41, famille « dette de trajectoire »).
//
// Fait : des fichiers ont été modifiés dans la session APRÈS sa dernière
// commande de vérification (test/build/lint/typecheck), ou sans qu'aucune
// vérification n'ait été lancée. Le coût affiché est le prix des jetons émis
// après la dernière preuve — du travail À RISQUE, pas un gaspillage prouvé,
// et le libellé des preuves le dit. Une vérification hors session (CI,
// terminal humain) est invisible : la formulation reste « dans la session ».

import { COST_BASIS, sumUsd } from './cost.ts';
import { THRESHOLDS } from './thresholds.ts';
import type { EvaluationContext, R7Recommendation, Session } from './types.ts';

const ID = 'R7';
const CATEGORY = 'rigueur';

interface ProjectAgg {
  sessions: string[];
  noVerification: number;
  withTail: number;
  files: number;
  tokens: number;
  pairs: Array<[Session, number]>;
  costComplete: boolean;
}

function evaluate(ctx: EvaluationContext): R7Recommendation[] {
  const byProject = new Map<string, ProjectAgg>();
  for (const session of ctx.sessions) {
    const v = session.report.verification;
    // Rapport stocké avant SCAN_VERSION 8 : le fait n'existe pas encore — la
    // session est écartée, jamais devinée (précédent : costByModel, v6).
    if (v === undefined) continue;
    if (v.editsTotal === 0) continue;
    const noVerif = v.verifications === 0;
    if (!noVerif && v.editsAfterLastVerification < THRESHOLDS.R7.minEditsAfterLastVerification) continue;
    const agg = byProject.get(session.project)
      ?? { sessions: [], noVerification: 0, withTail: 0, files: 0, tokens: 0, pairs: [], costComplete: true };
    agg.sessions.push(session.id);
    if (noVerif) agg.noVerification += 1; else agg.withTail += 1;
    agg.files += v.filesAfterLastVerificationTotal;
    agg.tokens += v.tokensAfterLastVerification;
    agg.pairs.push([session, v.tokensAfterLastVerification]);
    agg.costComplete = agg.costComplete && session.costComplete;
    byProject.set(session.project, agg);
  }

  const recs: R7Recommendation[] = [];
  for (const [project, agg] of byProject) {
    if (agg.sessions.length < THRESHOLDS.R7.minSessions) continue;
    recs.push({
      ruleId: ID,
      subject: project,
      title: 'Sessions terminées sans vérification finale',
      category: CATEGORY,
      confidence: 'fait',
      estimatedCostUsd: sumUsd(agg.pairs),
      costBasis: COST_BASIS.MEASURED_TOKENS,
      evidence: {
        sessions: agg.sessions,
        sessionsNoVerification: agg.noVerification,
        sessionsWithTail: agg.withTail,
        filesUnverified: agg.files,
        tokensAfterLastVerification: agg.tokens,
        costComplete: agg.costComplete,
      },
      action: 'Terminer par la preuve : relancer la commande de test ou de build après les dernières modifications, avant de clore la session.',
    });
  }
  return recs;
}

const subjectKind = 'project';

export { ID as id, CATEGORY as category, subjectKind, evaluate };

'use strict';
// R7 — modifications laissées sans vérification (doc/41, famille « dette de trajectoire »).
//
// Fait : des fichiers ont été modifiés dans la session APRÈS sa dernière
// commande de vérification (test/build/lint/typecheck), ou sans qu'aucune
// vérification n'ait été lancée. Le coût affiché est le prix des jetons émis
// après la dernière preuve — du travail À RISQUE, pas un gaspillage prouvé,
// et le libellé des preuves le dit. Une vérification hors session (CI,
// terminal humain) est invisible : la formulation reste « dans la session ».
//
// Deux comptes portent leur limite dans leur nom plutôt que dans une note :
// filesUnverifiedBySession est une somme PAR SESSION (l'union exacte des
// fichiers est hors de portée, la liste du moteur étant plafonnée), et
// excludedPendingRescan dit combien de sessions du projet ont été écartées
// faute du champ de SCAN_VERSION 8 — écartées, mais jamais en silence.

import { COST_BASIS, sumUsd } from './cost.ts';
import { THRESHOLDS } from './thresholds.ts';
import type { EvaluationContext, R7Recommendation, Session } from './types.ts';

const ID = 'R7';
const CATEGORY = 'rigueur';

interface ProjectAgg {
  sessions: string[];
  noVerification: number;
  withTail: number;
  filesBySession: number;
  tokens: number;
  pairs: Array<[Session, number]>;
  excludedPendingRescan: number;
  costComplete: boolean;
}

function evaluate(ctx: EvaluationContext): R7Recommendation[] {
  const byProject = new Map<string, ProjectAgg>();
  const aggOf = (project: string): ProjectAgg => {
    const known = byProject.get(project);
    if (known !== undefined) return known;
    const fresh: ProjectAgg = {
      sessions: [], noVerification: 0, withTail: 0, filesBySession: 0, tokens: 0,
      pairs: [], excludedPendingRescan: 0, costComplete: true,
    };
    byProject.set(project, fresh);
    return fresh;
  };

  for (const session of ctx.sessions) {
    const v = session.report.verification;
    // Rapport stocké avant SCAN_VERSION 8 : le fait n'existe pas encore — la
    // session est écartée, jamais devinée (précédent : costByModel, v6). Elle
    // est COMPTÉE au passage : une exclusion muette laisserait croire que le
    // projet n'a que les sessions listées.
    if (v === undefined) { aggOf(session.project).excludedPendingRescan += 1; continue; }
    if (v.editsTotal === 0) continue;
    const noVerif = v.verifications === 0;
    if (!noVerif && v.editsAfterLastVerification < THRESHOLDS.R7.minEditsAfterLastVerification) continue;
    const agg = aggOf(session.project);
    agg.sessions.push(session.id);
    if (noVerif) agg.noVerification += 1; else agg.withTail += 1;
    agg.filesBySession += v.filesAfterLastVerificationTotal;
    agg.tokens += v.tokensAfterLastVerification;
    agg.pairs.push([session, v.tokensAfterLastVerification]);
    agg.costComplete = agg.costComplete && session.costComplete;
  }

  const recs: R7Recommendation[] = [];
  for (const [project, agg] of byProject) {
    if (agg.sessions.length < THRESHOLDS.R7.minSessions) continue;
    recs.push({
      ruleId: ID,
      subject: project,
      // Pas « terminées » (revue doc/41) : rien ici ne filtre sur la fin de
      // session, une session encore vivante entre dans la reco.
      title: 'Sessions laissant des modifications non vérifiées',
      category: CATEGORY,
      confidence: 'fait',
      estimatedCostUsd: sumUsd(agg.pairs),
      costBasis: COST_BASIS.MEASURED_TOKENS,
      evidence: {
        sessions: agg.sessions,
        sessionsNoVerification: agg.noVerification,
        sessionsWithTail: agg.withTail,
        filesUnverifiedBySession: agg.filesBySession,
        tokensAfterLastVerification: agg.tokens,
        excludedPendingRescan: agg.excludedPendingRescan,
        costComplete: agg.costComplete,
      },
      action: 'Terminer par la preuve : relancer la commande de test ou de build après les dernières modifications, avant de clore la session.',
    });
  }
  return recs;
}

const subjectKind = 'project';

export { ID as id, CATEGORY as category, subjectKind, evaluate };

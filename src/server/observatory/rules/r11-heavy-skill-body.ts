'use strict';
// R11 — le texte d'un skill chargé dépasse la longueur conseillée par Anthropic pour un
// SKILL.md. Chargé, il reste dans le contexte jusqu'à la fin de la session ; le coût ne
// compte qu'un passage, c'est donc un minimum.

import { COST_BASIS, usdForBytes } from './cost.ts';
import { splitBySkillFacts } from './skill-facts.ts';
import { THRESHOLDS } from './thresholds.ts';
import type { EvaluationContext, R11Recommendation } from './types.ts';

const ID = 'R11';
const CATEGORY = 'skills';

interface BodyAgg {
  invocations: number;
  maxLines: number;
  bytes: number;
  usd: number;
  sessions: string[];
  costComplete: boolean;
}

function evaluate(ctx: EvaluationContext): R11Recommendation[] {
  const { ready, excludedPendingRescan } = splitBySkillFacts(ctx.sessions);
  const bySkill = new Map<string, BodyAgg>();
  for (const session of ready) {
    for (const body of session.report.skills.bodies) {
      const agg: BodyAgg = bySkill.get(body.skill)
        ?? { invocations: 0, maxLines: 0, bytes: 0, usd: 0, sessions: [], costComplete: true };
      agg.invocations += 1;
      agg.maxLines = Math.max(agg.maxLines, body.lines);
      agg.bytes += body.bytes;
      agg.usd += usdForBytes(session, body.bytes);
      agg.costComplete = agg.costComplete && session.costComplete;
      if (!agg.sessions.includes(session.id)) agg.sessions.push(session.id);
      bySkill.set(body.skill, agg);
    }
  }

  const recs: R11Recommendation[] = [];
  for (const [skill, agg] of bySkill) {
    if (agg.maxLines <= THRESHOLDS.R11.maxLines) continue;
    recs.push({
      ruleId: ID,
      subject: skill,
      title: `Skill « ${skill} » : ${agg.maxLines} lignes chargées en une fois`,
      category: CATEGORY,
      confidence: 'fait',
      estimatedCostUsd: agg.usd,
      costBasis: COST_BASIS.APPROX_BYTES,
      evidence: {
        sessions: agg.sessions, invocations: agg.invocations, maxLines: agg.maxLines, bytes: agg.bytes,
        excludedPendingRescan, costComplete: agg.costComplete,
      },
      action: 'Déplacer le détail dans des fichiers de référence que le skill fait lire à la demande '
        + '(Anthropic conseille un SKILL.md de moins de 500 lignes).',
    });
  }
  return recs;
}

const subjectKind = 'skill';

export { ID as id, CATEGORY as category, subjectKind, evaluate };

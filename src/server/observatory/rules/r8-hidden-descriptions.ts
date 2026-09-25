'use strict';
// R8 — un skill listé sans description : soit un réglage "name-only" (skillOverrides),
// soit la liste a dépassé son plafond et Claude Code l'a retirée lui-même. Le transcript ne
// distingue pas les deux causes, donc le titre énonce le fait mesuré, jamais la cause.
//
// Un skill sans description reste appelable, mais Claude le choisit moins souvent seul
// (doc Claude Code). Coût 0 : la liste est relue depuis le cache, et le taux moyen de la
// session la surévaluerait ; la carte ne monte donc jamais dans le bloc prioritaire (comme R2).

import { COST_BASIS } from './cost.ts';
import { splitBySkillFacts } from './skill-facts.ts';
import type { EvaluationContext, R8Recommendation } from './types.ts';

const ID = 'R8';
const CATEGORY = 'skills';
const SUBJECT = 'liste-des-skills';

function evaluate(ctx: EvaluationContext): R8Recommendation[] {
  const { ready, excludedPendingRescan } = splitBySkillFacts(ctx.sessions);
  const hiddenIn = new Map<string, number>();
  let largestListingChars = 0;
  for (const session of ready) {
    const { listing } = session.report.skills;
    largestListingChars = Math.max(largestListingChars, listing.reduce((acc, e) => acc + e.chars, 0));
    for (const entry of listing) {
      if (!entry.hasDescription) hiddenIn.set(entry.name, (hiddenIn.get(entry.name) ?? 0) + 1);
    }
  }
  if (hiddenIn.size === 0) return [];

  const touched = ready.filter(s => s.report.skills.listing.some(e => !e.hasDescription));
  const hidden = [...hiddenIn].map(([name, sessions]) => ({ name, sessions }))
    .sort((a, b) => b.sessions - a.sessions || (a.name < b.name ? -1 : 1));
  const n = hidden.length;
  return [{
    ruleId: ID,
    subject: SUBJECT,
    title: `${n} skill${n > 1 ? 's' : ''} listé${n > 1 ? 's' : ''} sans description`,
    category: CATEGORY,
    confidence: 'fait',
    estimatedCostUsd: 0,
    costBasis: COST_BASIS.MEASURED_TOKENS,
    evidence: {
      sessions: touched.map(s => s.id),
      hidden,
      sessionsAnalysed: ready.length,
      largestListingChars,
      excludedPendingRescan,
      costComplete: touched.every(s => s.costComplete),
    },
    action: 'Une description absente vient d’un réglage "name-only" (skillOverrides) ou du plafond de la liste. '
      + 'Dans le second cas : passer en "name-only" ou "off" les skills en double ou jamais appelés, '
      + 'ou relever skillListingBudgetFraction (par défaut 1 % de la fenêtre de contexte).',
  }];
}

const subjectKind = 'skillListing';

export { ID as id, CATEGORY as category, subjectKind, evaluate };

'use strict';
// R10 — un skill que seul l'utilisateur lance (« /nom » tapé), jamais choisi par Claude,
// garde sa description dans la liste à chaque tour. disable-model-invocation l'en retire ;
// la contrepartie est que Claude ne peut plus l'appeler seul. Non chiffré, comme R8.

import { COST_BASIS } from './cost.ts';
import { splitBySkillFacts } from './skill-facts.ts';
import { THRESHOLDS } from './thresholds.ts';
import type { EvaluationContext, R10Recommendation } from './types.ts';

const ID = 'R10';
const CATEGORY = 'skills';

interface Typed {
  count: number;
  sessions: string[];
}

function evaluate(ctx: EvaluationContext): R10Recommendation[] {
  const { ready, excludedPendingRescan } = splitBySkillFacts(ctx.sessions);
  const typed = new Map<string, Typed>();
  const modelCalls = new Map<string, number>();
  const describedChars = new Map<string, number>();
  for (const session of ready) {
    const { typed: typedHere, calls, listing } = session.report.skills;
    for (const [name, count] of Object.entries(typedHere)) {
      const agg: Typed = typed.get(name) ?? { count: 0, sessions: [] };
      agg.count += count;
      agg.sessions.push(session.id);
      typed.set(name, agg);
    }
    for (const [name, count] of Object.entries(calls)) modelCalls.set(name, (modelCalls.get(name) ?? 0) + count);
    for (const e of listing) {
      if (e.hasDescription) describedChars.set(e.name, Math.max(describedChars.get(e.name) ?? 0, e.chars));
    }
  }

  const recs: R10Recommendation[] = [];
  for (const [name, agg] of typed) {
    const entryChars = describedChars.get(name);
    if (agg.count < THRESHOLDS.R10.minTyped || (modelCalls.get(name) ?? 0) > 0 || entryChars === undefined) continue;
    recs.push({
      ruleId: ID,
      subject: name,
      title: `Skill « ${name} » lancé seulement à la main, sa description reste dans la liste`,
      category: CATEGORY,
      confidence: 'fait',
      estimatedCostUsd: 0,
      costBasis: COST_BASIS.NOT_PRICED,
      evidence: { sessions: agg.sessions, typedCount: agg.count, entryChars, excludedPendingRescan },
      action: 'Ajouter disable-model-invocation: true dans son SKILL.md, ou "user-invocable-only" dans skillOverrides '
        + 'pour un skill de plugin : sa description sort de la liste. Claude ne pourra plus l’appeler seul.',
    });
  }
  return recs;
}

const subjectKind = 'skill';

export { ID as id, CATEGORY as category, subjectKind, evaluate };

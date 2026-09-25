'use strict';
// R9 — un même skill figure plusieurs fois dans la liste (skill personnel et copie de
// plugin) : chaque copie occupe la liste et pousse d'autres descriptions hors du plafond.
// Non chiffré, pour la même raison que R8.

import { COST_BASIS } from './cost.ts';
import { baseName, splitBySkillFacts } from './skill-facts.ts';
import type { EvaluationContext, ListedSkill, R9Recommendation } from './types.ts';

const ID = 'R9';
const CATEGORY = 'skills';

interface Group {
  chars: Map<string, number>;
  // Le plafond de la liste retient le pire tour, pas l'union des noms vus sur la période :
  // le plus grand nombre de copies observé DANS UNE MÊME session.
  maxCopies: number;
  sessions: string[];
}

function evaluate(ctx: EvaluationContext): R9Recommendation[] {
  const { ready, excludedPendingRescan } = splitBySkillFacts(ctx.sessions);
  const groups = new Map<string, Group>();
  for (const session of ready) {
    const byBase = new Map<string, ListedSkill[]>();
    for (const entry of session.report.skills.listing) {
      const base = baseName(entry.name);
      byBase.set(base, [...(byBase.get(base) ?? []), entry]);
    }
    for (const [base, entries] of byBase) {
      if (entries.length < 2) continue;
      const group: Group = groups.get(base) ?? { chars: new Map(), maxCopies: 0, sessions: [] };
      for (const e of entries) group.chars.set(e.name, Math.max(group.chars.get(e.name) ?? 0, e.chars));
      group.maxCopies = Math.max(group.maxCopies, entries.length);
      group.sessions.push(session.id);
      groups.set(base, group);
    }
  }

  return [...groups].map(([base, group]): R9Recommendation => ({
    ruleId: ID,
    subject: base,
    title: `Skill « ${base} » présent ${group.maxCopies} fois dans la liste`,
    category: CATEGORY,
    confidence: 'fait',
    estimatedCostUsd: 0,
    costBasis: COST_BASIS.NOT_PRICED,
    evidence: {
      sessions: group.sessions,
      copies: [...group.chars].map(([name, chars]) => ({ name, chars }))
        .sort((a, b) => (a.name < b.name ? -1 : 1)),
      excludedPendingRescan,
    },
    action: 'Si ces copies font la même chose, en garder une seule : désactiver le plugin qui fait doublon, '
      + 'ou "off" dans skillOverrides pour la copie en trop.',
  }));
}

const subjectKind = 'skill';

export { ID as id, CATEGORY as category, subjectKind, evaluate };

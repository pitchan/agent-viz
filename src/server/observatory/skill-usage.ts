'use strict';
// Usage par skill pour le panneau « Skills » : usage seul. Un skill qui a servi
// était forcément proposé, donc proposé = listés ∪ utilisés, et utilisé =
// appelés ∪ marqués par Claude Code.

import type { Session, SkillFacts } from './rules/types.ts';
import { projectResolver } from './project-label.ts';

type SkillSession = Session & { report: Session['report'] & { skills: SkillFacts } };
const hasSkills = (s: Session): s is SkillSession => s.report.skills !== undefined;

interface SkillUsageRow {
  skill: string;
  offeredSessions: number;
  usedSessions: number;
  usedShare: number;
}

interface ProjectOption {
  project: string;
  label: string;
  sessions: number;
}

interface SkillUsageResult {
  skills: SkillUsageRow[];
  sessionsCounted: number;
  excludedPendingRescan: number;
  projects: ProjectOption[];
}

type SkillCount = Omit<SkillUsageRow, 'usedShare'>;

function count(sessions: SkillSession[]): SkillCount[] {
  const bySkill = new Map<string, SkillCount>();
  for (const s of sessions) {
    const { listed, calls, attributed } = s.report.skills;
    const used = new Set([...Object.keys(calls), ...attributed]);
    for (const skill of new Set([...listed, ...used])) {
      let c = bySkill.get(skill);
      if (!c) {
        c = { skill, offeredSessions: 0, usedSessions: 0 };
        bySkill.set(skill, c);
      }
      c.offeredSessions += 1;
      if (used.has(skill)) c.usedSessions += 1;
    }
  }
  return [...bySkill.values()];
}

const byName = (a: { skill: string }, b: { skill: string }) => a.skill.localeCompare(b.skill);

// Le menu ne promet que ce que le tableau peut montrer : il compte les sessions
// LUES. Le projet choisi y reste même à zéro, sinon une fenêtre plus courte
// ferait disparaître la ligne sélectionnée sous le curseur. Le libellé, lui,
// vient du résolveur bâti sur TOUTE la fenêtre (project-label.ts) : il ne
// dépend pas de l'ordre des sessions et rend le slug plutôt qu'un demi-vrai
// quand deux dossiers réels s'aplatissent sur le même slug.
function projectsOf(all: Session[], ready: SkillSession[], selected: string | undefined): ProjectOption[] {
  const pathOf = projectResolver(all);
  const byProject = new Map<string, ProjectOption>();
  for (const s of ready) {
    const found = byProject.get(s.project);
    if (found) { found.sessions += 1; continue; }
    byProject.set(s.project, { project: s.project, label: pathOf(s.project), sessions: 1 });
  }
  const list = [...byProject.values()].sort((a, b) => b.sessions - a.sessions || a.label.localeCompare(b.label));
  if (selected !== undefined && !byProject.has(selected)) list.push({ project: selected, label: pathOf(selected), sessions: 0 });
  return list;
}

function computeSkillUsage(sessions: Session[], project?: string): SkillUsageResult {
  const ready = sessions.filter(hasSkills);
  const scope = project === undefined ? ready : ready.filter(s => s.project === project);
  const inScope = project === undefined ? sessions : sessions.filter(s => s.project === project);
  const rows: SkillUsageRow[] = count(scope).map(c => ({ ...c, usedShare: c.usedSessions / c.offeredSessions }));
  // Le panneau se lit comme un classement d'usage, skills jamais utilisés compris :
  // à pourcentage égal, le skill vu dans le plus de sessions pèse plus lourd — et
  // pour les lignes à 0 %, celui qui a été le plus proposé.
  rows.sort((a, b) => b.usedShare - a.usedShare || b.usedSessions - a.usedSessions
    || b.offeredSessions - a.offeredSessions || byName(a, b));

  return {
    skills: rows,
    sessionsCounted: scope.length,
    excludedPendingRescan: inScope.length - scope.length,
    projects: projectsOf(sessions, ready, project),
  };
}

export { computeSkillUsage };
export type { ProjectOption, SkillUsageRow, SkillUsageResult };

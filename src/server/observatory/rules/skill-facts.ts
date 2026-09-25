'use strict';
// Les règles de skills lisent des faits qu'un rapport stocké avant SCAN_VERSION 14 ne porte
// pas : une telle session est écartée et comptée, jamais lue comme un zéro.

import type { Session, SkillFacts } from './types.ts';

type SkillSession = Session & { report: Session['report'] & { skills: Required<SkillFacts> } };

const hasListingFacts = (s: Session): s is SkillSession => {
  const skills = s.report.skills;
  return skills?.listing !== undefined && skills.typed !== undefined && skills.bodies !== undefined
    && skills.unattributedBodies !== undefined;
};

function splitBySkillFacts(sessions: Session[]): { ready: SkillSession[]; excludedPendingRescan: number } {
  const ready = sessions.filter(hasListingFacts);
  return { ready, excludedPendingRescan: sessions.length - ready.length };
}

// Un plugin préfixe ses skills (« anthropic-skills:docx ») : le nom de base réunit les copies.
const baseName = (name: string): string => name.slice(name.lastIndexOf(':') + 1);

export type { SkillSession };
export { splitBySkillFacts, baseName };

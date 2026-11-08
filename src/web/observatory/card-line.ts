// card-line.ts — ce que dit la ligne d'une carte conseil fermee. Module pur.
//
// Le detail complet reste dans la carte ouverte ; cette ligne ne fait que
// resumer des champs deja presents, elle n'en calcule aucun.

import { formatUsd, isUnpricedBasis, type Recommendation } from './format.ts';

// Le serveur accole le projet au titre sous cette seule forme
// (nameProjects, src/server/observatory/project-label.ts).
const PROJECT_SUFFIX = ' — projet ';

export function splitProjectTitle(title: string): { headline: string; project: string | null } {
  const at = title.lastIndexOf(PROJECT_SUFFIX);
  if (at < 0) return { headline: title, project: null };
  return { headline: title.slice(0, at), project: title.slice(at + PROJECT_SUFFIX.length) };
}

// Le dernier dossier d'un chemin ; un slug (pas de separateur) se montre entier.
export function projectBadge(project: string) {
  const parts = project.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? project;
}

// Coupe au premier « : » ou « ; » suivi d'un blanc, ou au premier point de fin
// de phrase — jamais au point d'un nom de fichier (« SKILL.md »).
const FIRST_CLAUSE_END = /\s*[:;](?=\s)|\.(?=\s|$)/;

export function gestureHead(action: string | null) {
  if (action == null) return 'aucun geste — carte informative';
  return action.split(FIRST_CLAUSE_END)[0]!.trim();
}

export function compactCost(rec: Recommendation) {
  if (isUnpricedBasis(rec.costBasis)) return 'non chiffré';
  const usd = formatUsd(rec.estimatedCostUsd);
  return rec.evidence.costComplete === false ? `≥ ${usd}` : usd;
}

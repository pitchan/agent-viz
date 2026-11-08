// card-line.ts — ce que dit la ligne d'une carte conseil fermee. Module pur : elle
// resume des champs deja presents dans la carte ouverte, elle n'en calcule aucun.

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

// La fin de la premiere proposition : « : » ou « ; » suivi d'un blanc, ou point
// de fin de phrase (jamais celui de « SKILL.md »), hors de ( ), [ ] et du code
// entre accents graves — y couper laisserait une valeur ou une parenthese ouverte.
function firstClauseEnd(text: string) {
  let depth = 0;
  let inCode = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    const blankAfter = i + 1 === text.length || /\s/.test(text[i + 1]!);
    if (c === '`') inCode = !inCode;
    else if (inCode) continue;
    else if (c === '(' || c === '[') depth++;
    else if ((c === ')' || c === ']') && depth > 0) depth--;
    else if (depth === 0 && blankAfter && (c === '.' || ((c === ':' || c === ';') && i + 1 < text.length))) return i;
  }
  return -1;
}

const MAX_HEAD = 80;

export function gestureHead(action: string | null) {
  if (action == null) return 'aucun geste — carte informative';
  const end = firstClauseEnd(action);
  if (end >= 0) return action.slice(0, end).trim();
  if (action.length <= MAX_HEAD) return action.trim();
  const cut = action.slice(0, MAX_HEAD);
  const space = cut.lastIndexOf(' ');
  return `${(space > 0 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

export function compactCost(rec: Recommendation) {
  if (isUnpricedBasis(rec.costBasis)) return 'non chiffré';
  const usd = formatUsd(rec.estimatedCostUsd);
  return rec.evidence.costComplete === false ? `≥ ${usd}` : usd;
}

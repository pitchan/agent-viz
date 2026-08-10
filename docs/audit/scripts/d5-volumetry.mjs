// D5 — volumétrie. OUTIL DE TRIAGE, JAMAIS UN VERDICT (doc/34).
//
// Aucun seuil de taille ne figure dans le CLAUDE.md du dépôt : un fichier long
// n'est en infraction de rien. On publie une distribution — médiane,
// percentile 90, maximum — et les extrêmes ouvrent une enquête.
//
// LA MÉTRIQUE PORTE SON PÉRIMÈTRE DANS SON NOM : `fonctionsMotCleFunction`.
// Elle ne compte QUE les déclarations par le mot-clé `function`, imbriquées
// comprises. Les fonctions fléchées et les méthodes de classe ou d'objet en
// sont absentes. La v1 appelait ça « fonctions » tout court, ce qui laissait
// croire à une couverture qu'elle n'avait pas.
//
// Le comptage d'accolades se fait sur les JETONS, donc une accolade dans une
// chaîne ou un commentaire ne le fausse pas — c'est l'objet du contrôle négatif.
import { tokenize } from './lib/tokens.mjs';

function functionSpans(tokens) {
  const spans = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].v !== 'function') continue;
    let j = i;
    while (j < tokens.length && tokens[j].v !== '{') j++;
    if (j >= tokens.length) break;
    let depth = 0;
    for (; j < tokens.length; j++) {
      if (tokens[j].v === '{') depth++;
      else if (tokens[j].v === '}' && --depth === 0) break;
    }
    spans.push({ ligneDebut: tokens[i].line, ligneFin: tokens[Math.min(j, tokens.length - 1)].line });
    // on NE saute PAS jusqu'à la fin : les fonctions imbriquées doivent être
    // comptées elles aussi.
  }
  return spans;
}

const stats = (values) => {
  if (values.length === 0) return { mediane: 0, p90: 0, max: 0 };
  const s = [...values].sort((a, b) => a - b);
  return {
    mediane: s[Math.floor(s.length / 2)],
    p90: s[Math.min(s.length - 1, Math.floor(s.length * 0.9))],
    max: s[s.length - 1],
  };
};

export function measure(files) {
  const parFichier = files.map(file => ({
    path: file.path,
    zone: file.zone,
    lignes: file.text.split('\n').length,
    exports: (file.text.match(/^\s*(?:export\s|module\.exports)/gm) ?? []).length,
    fonctionsMotCleFunction: functionSpans(tokenize(file.text)),
  }));
  const longueurs = parFichier.flatMap(f => f.fonctionsMotCleFunction.map(s => s.ligneFin - s.ligneDebut + 1));
  return {
    parFichier: parFichier.sort((a, b) => b.lignes - a.lignes),
    distribution: {
      lignes: stats(parFichier.map(f => f.lignes)),
      fonctionsMotCleFunction: stats(longueurs),
      exports: stats(parFichier.map(f => f.exports)),
    },
  };
}

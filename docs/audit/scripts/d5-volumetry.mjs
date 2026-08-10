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
//
// LIMITE CONSTATÉE PUIS CORRIGÉE À LA SOURCE (2026-08-10, arbitré par
// Vincent) : `functionSpans` dépend du comptage d'accolades sur les jetons de
// `tokenize`, et ce comptage POUVAIT être désynchronisé par un guillemet non
// apparié à l'intérieur d'une expression rationnelle littérale — même famille
// que la limite alors nommée dans l'en-tête de `lib/tokens.mjs` et dans celui
// de D4. La panne n'était PAS à sens unique ici (contrairement à celle de
// D4) : une accolade réelle avalée dans une fausse chaîne pouvait aussi bien
// faire DISPARAÎTRE une fonction du décompte que faire GONFLER la portée
// mesurée d'une autre.
//
// Mesuré AVANT correctif, sur ce dépôt : 3 des 113 fichiers du périmètre
// avaient un flux d'accolades global déséquilibré
// (`public/viz-invocation-patterns.mjs`, `netgain/src/doctor/aggregators/agent-gestures.ts`,
// `netgain/src/router/detector.ts`) — mais le test de flux d'accolades est
// FAIBLE (une chaîne factice dont le contenu avalé est lui-même équilibré ne
// laisse aucune trace), et le correctif l'a confirmé : DEUX fichiers de plus
// étaient touchés en silence, jamais signalés par ce test :
// `lib/install-hooks.js` (deux fonctions distinctes, `isAgentVizHook` et
// `isStandardShape`, fusionnées en une seule portée 71-87 par le guillemet de
// `/\/hook\.js(["'\s]|$)/`) et `netgain/src/doctor/aggregators/prompts.ts`
// (`classifyPrompt` et `isNoisePrompt`, deux fonctions totalement invisibles,
// zéro portée publiée pour un fichier qui en contenait deux).
//
// CORRIGÉ À LA SOURCE : `lib/tokens.mjs` reconnaît maintenant l'expression
// rationnelle littérale comme un jeton unique — l'en-tête de ce fichier
// détaille l'heuristique et ses limites résiduelles. Conséquence mesurée,
// AVANT → APRÈS sur ce dépôt, à ce commit :
//   - flux d'accolades déséquilibré : 3 fichiers → 0 fichier (113 fichiers
//     rescannés).
//   - `netgain/src/router/detector.ts` : 0 portée → 1
//     (`detectGraphSignal`, 54-60), la seule fonction du fichier, retrouvée.
//   - `netgain/src/doctor/aggregators/agent-gestures.ts` : 3 portées → 4
//     (`detectAgentGesture`, 33-52, retrouvée) ; `hasImportShape` corrigée de
//     21-50 (30 lignes, fausse) à 21-24 (4 lignes, réelle) — un facteur 7,5.
//   - `lib/install-hooks.js` : la portée fusionnée 71-87 devient deux portées
//     réelles, 71-77 et 83-87.
//   - `netgain/src/doctor/aggregators/prompts.ts` : 0 portée → 2 (26-31,
//     34-38).
//   - `public/viz-invocation-patterns.mjs` : SANS changement — sa fonction
//     unique (`classify`, 350-369) était déjà mesurée juste avant le
//     correctif (la corruption, hors de sa portée, ne la touchait pas) ; le
//     correctif ne fait ni gagner ni perdre de portée sur ce fichier.
//   - Total des portées publiées dans `docs/audit/resultats/d5.json` :
//     637 → 642 (+5 — 2 fonctions retrouvées + 1 fusion séparée en 2 + 1 paire
//     retrouvée dans `prompts.ts`).
//   - `distribution.fonctionsMotCleFunction` : médiane et maximum inchangés
//     (8 et 162 — le maximum, `renderReport` dans
//     `netgain/src/doctor/report/terminal.ts`, était déjà sain) ; p90 passe de
//     37 à 36, déplacement mineur cohérent avec l'ajout de 5 portées courtes
//     au corpus.
//   - `distribution.lignes` et `distribution.exports` : INCHANGÉS — ces deux
//     métriques ne dépendent pas de `tokenize`.
//   - D1 (`docs/audit/resultats/d1.json`) : ses 7 groupes de clones et leurs
//     0 groupes inter-zone sont identiques avant/après, confirmant que le
//     correctif ne fait apparaître aucun faux clone.
//
// Cette limite ne touchait QUE `fonctionsMotCleFunction` : `lignes` et
// `exports` ne dépendent pas de `tokenize` et n'ont jamais été concernés.
//
// Ce qui RESTE vrai après le correctif : D5 hérite de toute limite résiduelle
// de `lib/tokens.mjs` (voir son en-tête pour le détail, non dupliqué ici) —
// l'ambiguïté de `}` non résolue par construction, le mot-clé contextuel `of`
// délibérément non couvert, ET une division qui suit immédiatement une regex
// SANS DRAPEAU (trouvé par la revue, 2026-08-10 — mécanisme, reproduction et
// vérification d'absence dans l'en-tête de `lib/tokens.mjs`). Aucun de ces
// cas n'a été mesuré dans ce dépôt à ce commit.
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

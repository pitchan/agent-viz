// D6 — preuve de couverture, volontairement ASYMÉTRIQUE.
//
// « Aucun test ne m'importe » ne veut pas dire « je ne suis pas testé » : un
// module peut l'être transitivement, ou chargé par une page, une VM, un
// processus enfant. La mesure diffère donc selon la moitié du dépôt :
//   - chaîne Node (lib/, public/) : couverture d'EXÉCUTION, gratuite ;
//   - moteur (netgain/src/) : ATTEIGNABILITÉ STATIQUE seulement, faute de
//     provider de couverture Vitest installé — et en ajouter un pour un audit
//     qui ne doit rien modifier serait un prix mal placé (doc/34).
//
// Les limites sont publiées avec le résultat, pas dissimulées derrière un
// pourcentage.
//
// DÉFAUT CONSTATÉ (2026-08-10, en lançant D6 sur ce dépôt), PUIS CORRIGÉ
// (2026-08-10, arbitré par Vincent) : `parseLcov` associait une seule valeur
// par chemin (`Map.set`, dernier bloc lu gagne), or le reporter `lcov` de
// Node émet un bloc `SF:` par EXÉCUTION de module, pas par fichier. Un
// fichier réimporté dynamiquement plusieurs fois dans la même suite — ici via
// un suffixe de cache-busting (`import(... + '?t=' + Math.random())`),
// utilisé pour repartir d'un état singleton neuf entre tests — produit donc
// plusieurs blocs `SF:` pour le même chemin ; le dernier lu écrasait les
// précédents, ce qui n'était ni le meilleur ni un agrégat des lignes
// réellement exécutées. MESURÉ sur ce dépôt à ce commit : `public/
// viz-watchdog-client.js` est le SEUL chemin sur 85 à porter plusieurs blocs
// `SF:` (31, contre 1 pour chacun des 84 autres), à cause de 4 sites de
// réimport dans `tests/unit/watchdog-client-reader.test.mjs`. VÉRIFIÉ NON
// DÉTERMINISTE : deux lancements consécutifs et identiques de la commande de
// l'étape 1 ont produit deux valeurs différentes de `lignesCouvertes` pour ce
// fichier avec l'ancien code (175 puis 140, plage observée sur les 31 blocs :
// 138 à 209, `lignesTotales` constant à 230) — les fichiers de test tournent
// en parallèle sous `node --test`, l'ordre de fusion des blocs dans le lcov
// final est une course. MESURÉ ENSUITE, ligne à ligne (`DA:`) : l'union réelle
// des 31 blocs est 230/230 — ce fichier est intégralement couvert, ce que
// n'importe laquelle des deux valeurs fautives (175, 140) contredisait.
//
// Correctif : `parseLcov` additionne désormais les lignes `DA:<numéro>,
// <compte>` de TOUS les blocs d'un même chemin (une ligne comptée dans
// N'IMPORTE LEQUEL des blocs reste comptée dans l'union — OU logique,
// commutatif, le résultat ne dépend structurellement plus de l'ordre de
// lecture), et se replie sur `LH:`/`LF:` uniquement pour un chemin qui ne
// porte AUCUNE ligne `DA:` — cas du fixture `LCOV` de ce fichier de test,
// resté vert sans modification. CONTRÔLE DE MÉTHODE qui valide l'approche :
// sur un chemin à bloc unique (`lib/install-hooks.js`), l'union des `DA:` à
// compte non nul est EXACTEMENT égale au `LH:` déclaré (488 = 488) — l'union
// ne réinvente pas la mesure existante, elle l'étend au cas à plusieurs
// blocs. Autre vérification faite sur ce dépôt à ce commit : les 31 blocs de
// `public/viz-watchdog-client.js` énumèrent tous le MÊME ensemble de 230
// numéros de ligne en `DA:` — l'union ne gonfle donc pas `found` ici.
//
// Ce qui reste, non couvert par ce correctif : (1) rien ne VÉRIFIE que deux
// blocs d'un même chemin énumèrent le même ensemble de lignes en `DA:` — si
// un jour ils divergeaient (fichier modifié entre deux exécutions, coverage
// partiel selon un flag), `found` deviendrait l'union des ensembles, pas la
// taille attendue d'un seul ; constaté absent sur ce dépôt à ce commit, non
// gardé par un contrôle automatisé. (2) `parseLcov` ne lit que les lignes
// `DA:` : les enregistrements `FN:`/`FNDA:` (fonctions) et `BRDA:` (branches)
// du même fichier lcov — bien présents, 2685 lignes `BRDA:` et 1283 `FNDA:`
// mesurées sur ce dépôt à ce commit — ne sont pas exploités ; une ligne peut
// être « couverte » (comptée au moins une fois) alors qu'une branche à
// l'intérieur ne l'est pas, ce que ce détecteur ne voit pas et ne prétend pas
// voir. (3) Si TOUS les blocs d'un même chemin sont dépourvus de toute ligne
// `DA:`, la fusion ne passe jamais par la branche `entry.lignes.size > 0` et
// les champs scalaires `hit`/`found` reviennent au DERNIER bloc `LH:`/`LF:`
// lu (lignes 78-81 ci-dessus) — le non-déterminisme d'origine, corrigé pour
// le cas général, ressurgirait sur ce cas précis. Non attesté sur ce dépôt à
// ce commit, et non reproductible par le rapporteur `lcov` de Node tant
// qu'un chemin porte `LF:>0` (il émet alors toujours au moins une `DA:` par
// bloc).
import { buildGraph } from './d4-import-graph.mjs';

export function parseLcov(text) {
  const files = new Map();
  let current = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('SF:')) {
      current = line.slice(3).trim().split('\\').join('/');
      if (!files.has(current)) files.set(current, { hit: 0, found: 0, lignes: new Map() });
    } else if (current && line.startsWith('LH:')) {
      files.get(current).hit = Number(line.slice(3));
    } else if (current && line.startsWith('LF:')) {
      files.get(current).found = Number(line.slice(3));
    } else if (current && line.startsWith('DA:')) {
      const [numero, compte] = line.slice(3).split(',').map(Number);
      const lignes = files.get(current).lignes;
      // OU logique, commutatif et associatif : une ligne couverte par
      // N'IMPORTE LEQUEL des blocs du chemin reste couverte dans l'union,
      // quel que soit l'ordre dans lequel les blocs sont lus.
      lignes.set(numero, (lignes.get(numero) ?? false) || compte > 0);
    }
  }
  const result = new Map();
  for (const [path, entry] of files) {
    if (entry.lignes.size > 0) {
      const hit = [...entry.lignes.values()].filter(Boolean).length;
      result.set(path, { hit, found: entry.lignes.size });
    } else {
      result.set(path, { hit: entry.hit, found: entry.found });
    }
  }
  return result;
}

export function coverageReport(files, tests, lcovText) {
  const lcov = parseLcov(lcovText);
  const executee = [];
  const sansPreuveDExecution = [];
  for (const file of files) {
    if (file.zone === 'engine') continue;
    const hit = lcov.get(file.path);
    if (hit) executee.push({ path: file.path, lignesCouvertes: hit.hit, lignesTotales: hit.found });
    else sansPreuveDExecution.push(file.path);
  }

  const engine = files.filter(f => f.zone === 'engine');
  const { edges } = buildGraph([...engine, ...tests]);
  const reachable = new Set();
  const visit = (node) => {
    for (const next of edges.get(node) ?? []) {
      if (reachable.has(next)) continue;
      reachable.add(next);
      visit(next);
    }
  };
  for (const t of tests) visit(t.path);

  return {
    executee: executee.sort((a, b) => a.lignesCouvertes / a.lignesTotales - b.lignesCouvertes / b.lignesTotales),
    sansPreuveDExecution: sansPreuveDExecution.sort(),
    atteignableStatiquement: engine.map(f => f.path).filter(p => reachable.has(p)).sort(),
    inatteignable: engine.map(f => f.path).filter(p => !reachable.has(p)).sort(),
    limites: [
      'Un chargement dynamique (import() calculé, VM, processus enfant) échappe aux deux mesures.',
      'Le moteur n’a pas de couverture d’exécution : atteignabilité statique seulement.',
      'Un fichier « sans preuve d’exécution » n’est PAS un fichier non testé.',
    ],
  };
}

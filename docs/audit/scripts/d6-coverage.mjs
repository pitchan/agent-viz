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
// LIMITE CONSTATÉE (2026-08-10, en lançant D6 sur ce dépôt) : `parseLcov`
// associe une seule valeur par chemin (`Map.set`, dernier bloc lu gagne), or
// le reporter `lcov` de Node émet un bloc `SF:` par EXÉCUTION de module, pas
// par fichier. Un fichier réimporté dynamiquement plusieurs fois dans la même
// suite — ici via un suffixe de cache-busting (`import(... + '?t=' +
// Math.random())`), utilisé pour repartir d'un état singleton neuf entre
// tests — produit donc plusieurs blocs `SF:` pour le même chemin ; le dernier
// lu écrase les précédents, ce qui n'est ni le meilleur ni un agrégat des
// lignes réellement exécutées. Constaté sur ce dépôt à ce commit :
// `public/viz-watchdog-client.js` est le SEUL fichier concerné (4 sites de
// réimport dans `tests/unit/watchdog-client-reader.test.mjs`), avec 31 blocs
// `SF:` pour ce chemin contre 1 pour chacun des 72 autres fichiers couverts.
// VÉRIFIÉ NON DÉTERMINISTE : deux lancements consécutifs et identiques de la
// commande de l'étape 1 ont produit deux valeurs différentes de
// `lignesCouvertes` pour ce fichier (175 puis 140, la plage observée sur les
// 31 blocs allant de 138 à 209, `lignesTotales` restant constant à 230) — les
// fichiers de test tournent en parallèle sous `node --test`, et l'ordre de
// fusion des blocs de couverture dans le fichier lcov final est une course.
// Le nombre publié pour ce fichier précis n'est donc pas reproductible d'un
// lancement à l'autre et ne doit pas être lu comme « la » couverture de ce
// fichier. `parseLcov` reste inchangé — instrument verbatim du plan — seul ce
// paragraphe documente la limite.
import { buildGraph } from './d4-import-graph.mjs';

export function parseLcov(text) {
  const files = new Map();
  let current = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('SF:')) {
      current = line.slice(3).trim().split('\\').join('/');
      files.set(current, { hit: 0, found: 0 });
    } else if (current && line.startsWith('LH:')) {
      files.get(current).hit = Number(line.slice(3));
    } else if (current && line.startsWith('LF:')) {
      files.get(current).found = Number(line.slice(3));
    }
  }
  return files;
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

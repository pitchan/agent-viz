// Garde d'environnement du harnais. Elle tourne AVANT tout module de test :
// - vitest : premiere entree de `setupFiles`, executee dans chaque worker
//   avant que le fichier de test (et ses require/import de portee de module)
//   ne charge ;
// - node --test : via `--import`, executee dans le processus principal puis
//   heritee (env) par chaque processus fils de test.
//
// Son role n'est PAS de remplacer les detournements que les tests posent
// eux-memes (watchdog-*.test, claude-dir-cli.test, install-hooks-entrypoint) :
// eux tournent APRES et gardent le dernier mot. Son role est d'etre le
// PLANCHER : si un point d'entree de production perd un jour sa garde
// (mutation, migration), l'ecriture part dans un bac jetable, jamais dans le
// vrai ~/.claude ni ~/.agent-viz.
//
// Mesure (doc/39, decision prevention-harnais, § 4) : sous
// Windows `os.homedir()` suit USERPROFILE seul ; HOME seule ne detourne rien.
// `os.tmpdir()` et `os.homedir()` relisent l'environnement a chaque appel.
// AGENT_VIZ_PORT=59999 est un port ou aucun demon n'ecoute : un runHook()
// accidentel parle dans le vide — reconduction d'un port deja employe ailleurs
// dans le depot (`tests/unit/hook-runtime.test.mjs`,
// `tests/unit/install-hooks-entrypoint.test.mjs`), pas une valeur inventee.
//
// CE QUE CE FICHIER NE COUVRE PAS (les cinq limites de la decision, § 7) :
//   1. L'ecriture cote DEPOT : `install-hooks.js` sait ajouter une ligne au
//      `.gitignore` de `findProjectRoot(cwd)` — aucun detournement de home ne
//      l'empeche. `git status --porcelain` reste le controle qui la voit.
//   2. Les executions HORS harnais : un script lance directement
//      (`node src/server/install-hooks.js`), `npm start`, le bin, ou un
//      fichier de test lance NU sans runner ne passent ni par `setupFiles`
//      ni par `--import`.
//   3. Un `node --test` tape a la main SANS `--import` : seuls les DEUX
//      scripts npm (`test:node`, `test:ids:node`) portent le drapeau.
//   4. La garde de harnais ELLE-MEME : retirer cette entree de `setupFiles`
//      ou ce `--import` fait tomber la prevention sans bruit. Le filet qui
//      reste alors est `tests/unit/install-hooks-entrypoint.test.mjs` (G1/G2,
//      detection) — doublure voulue, pas un repli suppose.
//   5. `~/.agent-viz/observatory.db` : couverte par ricochet (vit sous
//      `os.homedir()/.agent-viz`, suit donc le detournement) mais un demon
//      REEL deja lance sur la machine continue d'y ecrire — cette garde
//      empeche seulement LES TESTS de lui parler (port mort, AGENT_VIZ_PORT
//      ci-dessus) ou d'ecrire chez lui, pas le demon deja vivant.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PREFIXE_BAC = 'agent-viz-harnais-';
const AGE_MIN_PURGE_MS = 10 * 60 * 1000;

// Purge des bacs ANTERIEURS, avant de creer celui de ce run. Sans elle,
// chaque run (dev, CI) en laisse un de plus dans le vrai `%TEMP%` — une fuite
// disque sans fin sur mille runs. Elle garde la valeur d'autopsie du DERNIER
// bac (celui que ce run cree juste apres l'avoir appelee) et ne touche que
// les autres.
//
// SEUIL D'AGE, pas "tout ce qui existe deja" : un run cree PLUSIEURS bacs,
// pas un seul — voir la note sur l'idempotence plus bas. Mesure sur ce
// depot (2026-08-13) : `node --test` sur le glob complet des deux scripts npm
// (76 fichiers `.cjs`/`.mjs`, 841 tests) cree 76 bacs en 2,4 s ; vitest
// (121 fichiers, 1365 tests) en 6 a 8 s. Purger sans seuil d'age ferait
// qu'un fichier supprime le bac tout juste cree par son voisin, ENCORE EN
// COURS D'USAGE. Un seuil de 10 minutes laisse une marge superieure a x70 sur
// le run complet le plus lent mesure ici, tout en bornant l'accumulation sur
// des runs repetes (dev quotidien, CI).
//
// Trois garde-fous, non negociables :
//   1. le prefixe compare est EXACT (`agent-viz-harnais-`), jamais un motif
//      large ; seuls les dossiers qui le portent sont candidats.
//   2. un lien symbolique n'est ni suivi ni supprime : `readdirSync` avec
//      `withFileTypes` donne un `Dirent` dont `isDirectory()` vaut FALSE pour
//      un lien (mesure : une jonction Windows vers un vrai dossier rend
//      `isDirectory()=false`, `isSymbolicLink()=true`) — le filtre l'ecarte
//      sans jamais resoudre sa cible, donc sans jamais la supprimer non plus.
//   3. un echec de suppression (bac verrouille par un autre processus) est
//      avale : ce nettoyage ne doit jamais faire tomber un run.
function purgeAnciensBacs(parent) {
  let entrees;
  try { entrees = fs.readdirSync(parent, { withFileTypes: true }); }
  catch { return; }
  const maintenant = Date.now();
  for (const entree of entrees) {
    if (!entree.name.startsWith(PREFIXE_BAC)) continue;
    if (!entree.isDirectory()) continue; // lien symbolique ou fichier : jamais touche
    const cible = path.join(parent, entree.name);
    let infos;
    try { infos = fs.statSync(cible); } catch { continue; }
    if (maintenant - infos.mtimeMs < AGE_MIN_PURGE_MS) continue; // trop recent : peut etre un voisin de CE run
    try { fs.rmSync(cible, { recursive: true, force: true }); } catch { /* verrouille par un autre processus : on continue */ }
  }
}

// Idempotente DANS UN MEME PROCESSUS : le marqueur evite qu'un processus qui
// herite deja de l'environnement detourne (un fils issu d'UN SEUL fichier
// passe a `node --test`, mesure) n'en recree un second. Ce N'EST PAS un
// partage entre fichiers freres d'un meme run : mesure (2026-08-13) — deux
// fichiers explicites passes au meme `node --test` produisent DEUX bacs, pas
// un ; chaque fichier est son propre processus et ne voit pas le marqueur
// pose par les autres. C'est precisement pourquoi la purge ci-dessus raisonne
// en "plusieurs bacs par run", jamais en "un seul".
if (!process.env.AGENT_VIZ_BAC_HARNAIS) {
  const parent = os.tmpdir();
  purgeAnciensBacs(parent);
  const bac = fs.mkdtempSync(path.join(parent, PREFIXE_BAC));
  process.env.AGENT_VIZ_BAC_HARNAIS = bac;
  process.env.USERPROFILE = bac;
  process.env.HOME = bac;
  process.env.TEMP = bac;
  process.env.TMP = bac;
  process.env.TMPDIR = bac;
}
process.env.AGENT_VIZ_PORT = '59999';

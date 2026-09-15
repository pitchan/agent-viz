// Garde d'environnement du harnais, executee avant chaque fichier de test : premiere entree
// de `setupFiles` sous vitest, `--import` de chaque processus fils sous node --test.
//
// Elle est un PLANCHER : les detournements des tests gardent le dernier mot, mais un point
// d'entree qui perd sa garde ecrit dans un bac jetable, jamais dans ~/.claude ni ~/.agent-viz.
//
// USERPROFILE est detourne avec HOME : sous Windows `os.homedir()` suit USERPROFILE seul,
// relu a chaque appel, comme TEMP par `os.tmpdir()`. Aucun demon n'ecoute sur le port 59999.
//
// Ce qu'elle ne couvre pas :
//   1. le `.gitignore` du depot, ou `install-hooks.ts` peut ecrire (`git status` le voit) ;
//   2. une execution hors harnais : script lance directement, `npm start`, le bin, test nu ;
//   3. un `node --test` sans `--import` : seuls `test:node` et `test:ids:node` le portent ;
//   4. son retrait : reste `tests/unit/install-hooks-entrypoint.test.mjs`, qui detecte sans empecher ;
//   5. un demon reel deja lance, qui continue d'ecrire dans `~/.agent-viz/observatory.db`.
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
// pas un seul — voir la note sur l'idempotence plus bas. Purger sans seuil
// d'age ferait qu'un fichier supprime le bac tout juste cree par son voisin,
// ENCORE EN COURS D'USAGE. Mesure sur ce depot : un run complet cree un bac
// par fichier de test en moins de 15 s ; le seuil de 10 minutes laisse une
// marge superieure a x40, tout en bornant l'accumulation sur des runs repetes
// (dev quotidien, CI).
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

// Le marqueur empeche un second bac dans un processus qui l'a deja, pose ou herite.
// Il ne relie pas les fichiers d'un run : sous vitest comme sous node --test, chaque
// fichier de test cree son bac, d'ou le seuil d'age de la purge ci-dessus.
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

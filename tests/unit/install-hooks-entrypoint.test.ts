// La garde de point d entree de `src/server/install-hooks.ts` decide si le module
// agit au chargement. C est ce module qui ecrit un chemin absolu dans le
// `settings.json` de l utilisateur : sa garde a son propre filet.
//
// Les deux tests ci-dessous tiennent la garde par ses DEUX bords :
//   G1  lance comme un script, le module DOIT parler   -> `if (false && ...)` rougit
//   G2  importe, le module DOIT se taire               -> `if (true  || ...)` rougit
//
// Un seul des deux ne suffit pas : G1 seul laisserait passer une garde toujours
// vraie, et c est precisement ce sens-la qui est dangereux.
//
// Tout se joue en PROCESSUS FILS : dans la branche gardee, le module a des effets
// de bord AU CHARGEMENT, et les deux executeurs lancent plusieurs fichiers EN
// PARALLELE ; dans le processus de test, ces effets contamineraient ses voisins.
//
// Chaque fils recoit un home JETABLE : sous Windows `os.homedir()` suit
// USERPROFILE SEUL. Sans ce detournement, la mutation `true ||` reecrirait le
// `~/.claude/settings.json` REEL et repointerait les hooks de capture de la machine.
//
// Le fils tourne aussi avec `cwd` HORS du depot : ce module sait ajouter une
// ligne au `.gitignore` de `findProjectRoot(cwd)`, qu aucun detournement de
// home ne protege.

import { expect, test } from 'vitest';
import { spawnSync, type SpawnSyncOptionsWithStringEncoding } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const INSTALL_HOOKS = fileURLToPath(new URL('../../src/server/install-hooks.ts', import.meta.url));
const PREFIXE = 'agent-viz-entrypoint-';

// Sous-chaine RELEVEE de la sortie reelle (`node src/server/install-hooks.ts
// --user --check`), jamais devinee. Seul `cliMain` l emet, depuis la seule branche
// gardee : aucune autre voie du fichier n emet cette ligne (le « masque amont »).
const SEULE_LA_BRANCHE_GARDEE = '[claude] settings :';

// CHOIX DELIBERE : `import()`, JAMAIS `require()`. Un `require()` jette ERR_REQUIRE_ASYNC_MODULE
// sur une top-level await (Node v24.15.0) ; `import()` se comporte a l IDENTIQUE sur une cible
// CommonJS et sur une cible ES module, donc un rouge de G2 signifie toujours « la garde a fui ».
//
// Le fils importe la cible par son URL `file:`. On passe par l environnement et
// non par argv : une chaine `C:\...` passee a `import()` se lit comme un
// specificateur nu et rendrait ERR_MODULE_NOT_FOUND pour une raison qui n a
// rien a voir avec la garde.
const SOURCE_DU_FILS = `
import(process.env.AV_CIBLE_URL).catch((e) => {
  console.error('ECHEC DE CHARGEMENT ' + ((e && e.code) || '') + ' ' + ((e && e.message) || e));
  process.exitCode = 1;
});
`;

function homeJetable() {
  return fs.mkdtempSync(path.join(os.tmpdir(), PREFIXE));
}

function efface(dir: string) {
  // Garde-fou : on ne supprime que ce qu on vient de fabriquer.
  if (dir && dir.includes(PREFIXE)) fs.rmSync(dir, { recursive: true, force: true });
}

// Liste RECURSIVE des fichiers sous `dir` (chemins relatifs, tries). Un
// `readdirSync` a plat ne verrait pas `.claude/settings.json`, qui est
// justement le fichier que la garde ecrit.
function fichiersSous(dir: string) {
  const trouves: string[] = [];
  const pile: string[] = [dir];
  while (pile.length > 0) {
    // Le dossier courant se retient ici, jamais via `Dirent.path` /
    // `Dirent.parentPath` : ces deux champs n existent pas sur toutes les
    // versions de Node, et un `undefined` fabriquerait des chemins faux.
    const courant = pile.pop()!;
    for (const e of fs.readdirSync(courant, { withFileTypes: true })) {
      const p = path.join(courant, e.name);
      if (e.isDirectory()) pile.push(p);
      else trouves.push(path.relative(dir, p));
    }
  }
  return trouves.sort();
}

function environnement(maison: string) {
  return {
    ...process.env,
    USERPROFILE: maison,
    HOME: maison,
    TEMP: maison,
    TMP: maison,
    AGENT_VIZ_PORT: '59999',
    AV_CIBLE_URL: pathToFileURL(INSTALL_HOOKS).href,
  };
}

const options = (maison: string): SpawnSyncOptionsWithStringEncoding =>
  ({ cwd: maison, encoding: 'utf8', env: environnement(maison) });

const lanceCommeScript = (args: string[], maison: string) =>
  spawnSync(process.execPath, [INSTALL_HOOKS, ...args], options(maison));
// Le chargement se fait par `import()` et pas par `require()` : choix delibere,
// motif complet a `SOURCE_DU_FILS`. Ne pas le remplacer.
const lanceCommeImport = (maison: string) => spawnSync(process.execPath, ['-e', SOURCE_DU_FILS], options(maison));

test('G1 : lance comme un script, la branche de point d entree s execute et parle', () => {
  const maison = homeJetable();
  try {
    // `--check` est le mode qui N ECRIT PAS (mesure) : ce test n a besoin que
    // de la sortie, pas d une installation.
    const r = lanceCommeScript(['--user', '--check'], maison);
    expect(r.error, `le fils n a pas demarre : ${r.error}`).toBe(undefined);

    // On lit la SORTIE, pas le code de retour : `--check` sort en 1 quand les
    // hooks ne sont pas installes (mesure), ce qui est le cas d un home neuf.
    expect(r.stdout.includes(SEULE_LA_BRANCHE_GARDEE), `la sortie doit porter ${JSON.stringify(SEULE_LA_BRANCHE_GARDEE)}\n`
      + `stdout=${JSON.stringify(r.stdout)}\nstderr=${JSON.stringify(r.stderr)}`).toBeTruthy();

    // Et cette sortie doit venir du home DETOURNE. Sans ce controle, un test
    // vert pourrait etre un test qui vient de lire le vrai `~/.claude`. On
    // compare sur le suffixe aleatoire du dossier, insensible a la casse : le
    // prefixe du chemin, lui, peut etre normalise par l OS.
    const marqueur = path.basename(maison).toLowerCase();
    expect(r.stdout.toLowerCase().includes(marqueur), `la sortie doit citer le home jetable (${marqueur}) ; stdout=${JSON.stringify(r.stdout)}`).toBeTruthy();
  } finally {
    efface(maison);
  }
});

test('G2 : importe, le module se tait — sortie 0, rien sur stdout ni stderr, rien sur le disque', () => {
  const maison = homeJetable();
  try {
    // ASSIETTE : sans elle, un « aucun fichier ecrit » final ne prouverait rien.
    expect(fichiersSous(maison), 'le home jetable doit partir vide').toEqual([]);

    const r = lanceCommeImport(maison);
    expect(r.error, `le fils n a pas demarre : ${r.error}`).toBe(undefined);

    // stderr et le code de sortie D ABORD. Un chargement qui ECHOUE parle sur
    // stderr et sort en non-zero ; un test qui n observerait que stdout lirait
    // « aucune sortie » et passerait — un silence de panne se lirait comme un
    // silence de bonne conduite.
    // L echec vise est celui d un module REELLEMENT incapable de se charger
    // (ERR_MODULE_NOT_FOUND). ERR_REQUIRE_ASYNC_MODULE ne peut PAS apparaitre
    // tant que le chargement passe par l `import()` de `SOURCE_DU_FILS` ; s il
    // apparaissait, ce serait le signe qu on l a remplace par un `require()`.
    // Attention : son ABSENCE ne prouve rien en sens inverse — un `require()`
    // sur un module ES SANS top-level await reussit (mesure, Node v24.15.0).
    expect(r.stderr, `stderr doit etre vide, recu : ${r.stderr}`).toBe('');
    expect(r.status, `le fils doit sortir en 0, recu : ${r.status}`).toBe(0);
    expect(r.stdout, `stdout doit etre vide, recu : ${r.stdout}`).toBe('');

    // Le bord le plus couteux : la garde toujours vraie ecrit un
    // `.claude/settings.json` sous le home.
    expect(fichiersSous(maison), 'un simple import ne doit ecrire aucun fichier sous le home').toEqual([]);
  } finally {
    efface(maison);
  }
});

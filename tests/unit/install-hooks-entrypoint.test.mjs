// La garde de point d entree de `src/server/install-hooks.js` etait le seul
// point d entree du depot SANS filet : doc/36 § 4.3, mesure — neutraliser la
// garde de `hook.js` fait rougir 3 tests nommes, neutraliser celle-ci laisse la
// suite ENTIEREMENT VERTE. Or c est ce fichier-la qui ecrit un chemin absolu
// dans le `settings.json` de l utilisateur.
//
// Les deux tests ci-dessous tiennent la garde par ses DEUX bords :
//   G1  lance comme un script, le module DOIT parler   -> `if (false && ...)` rougit
//   G2  importe, le module DOIT se taire               -> `if (true  || ...)` rougit
//
// Un seul des deux ne suffit pas : G1 seul laisserait passer une garde toujours
// vraie, et c est precisement ce sens-la qui est dangereux.
//
// Tout se joue en PROCESSUS FILS, jamais dans le processus de test. Deux
// raisons mesurees : dans la branche gardee le module a des effets de bord AU
// CHARGEMENT, et les deux executeurs (vitest, `node --test`) lancent plusieurs
// fichiers EN PARALLELE — un effet de bord dans le processus de test
// contaminerait ses voisins.
//
// Chaque fils recoit un home JETABLE. Mesure : sous Windows `os.homedir()` suit
// USERPROFILE SEUL, HOME seul ne detourne rien ; HOMEPATH est inoperant. Ce
// detournement n est pas du confort : sans lui, la mutation `true ||` fait
// reecrire le `~/.claude/settings.json` REEL et repointer les six crochets de
// capture de la machine.
//
// Le fils tourne aussi avec `cwd` HORS du depot : ce module sait ajouter une
// ligne au `.gitignore` de `findProjectRoot(cwd)`, qu aucun detournement de
// home ne protege.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const INSTALL_HOOKS = fileURLToPath(new URL('../../src/server/install-hooks.js', import.meta.url));
const PREFIXE = 'agent-viz-entrypoint-';

// Sous-chaine RELEVEE de la sortie reelle (`node src/server/install-hooks.js
// --user --check`), jamais devinee. Elle n est emise que par `cliMain`, et
// `cliMain` n est appele que depuis la branche gardee : mesure du meme step, un
// import du module ne produit RIEN — ni sur stdout, ni sur stderr, ni sur le
// disque. C est ce qui ferme le « masque amont » : aucune autre voie du fichier
// n emet cette ligne.
const SEULE_LA_BRANCHE_GARDEE = '[claude] settings :';

// CHOIX DELIBERE : `import()`, JAMAIS `require()`. NE PAS « CORRIGER ».
// La tache 8 traduit `install-hooks.js` en ESM puis REJOUE sur lui les mutations
// de garde, et c est la que ce filet doit mordre. Or un `require()` d un module
// ESM jette ERR_REQUIRE_ASYNC_MODULE : G2 virerait au rouge sur une migration
// CORRECTE — un faux rouge au pire moment, dont le reflexe serait de desarmer le
// filet plutot que d en lire le signal. `import()` charge indifferemment
// CommonJS et ESM : un rouge de G2 signifie donc « la garde a fui », jamais
// « le mecanisme de test a vieilli ».
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

function efface(dir) {
  // Garde-fou : on ne supprime que ce qu on vient de fabriquer.
  if (dir && dir.includes(PREFIXE)) fs.rmSync(dir, { recursive: true, force: true });
}

// Liste RECURSIVE des fichiers sous `dir` (chemins relatifs, tries). Un
// `readdirSync` a plat ne verrait pas `.claude/settings.json`, qui est
// justement le fichier que la garde ecrit.
function fichiersSous(dir) {
  const trouves = [];
  const pile = [dir];
  while (pile.length > 0) {
    // Le dossier courant se retient ici, jamais via `Dirent.path` /
    // `Dirent.parentPath` : ces deux champs n existent pas sur toutes les
    // versions de Node, et un `undefined` fabriquerait des chemins faux.
    const courant = pile.pop();
    for (const e of fs.readdirSync(courant, { withFileTypes: true })) {
      const p = path.join(courant, e.name);
      if (e.isDirectory()) pile.push(p);
      else trouves.push(path.relative(dir, p));
    }
  }
  return trouves.sort();
}

function environnement(maison) {
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

const options = (maison) => ({ cwd: maison, encoding: 'utf8', env: environnement(maison) });

const lanceCommeScript = (args, maison) => spawnSync(process.execPath, [INSTALL_HOOKS, ...args], options(maison));
// Le chargement se fait par `import()` et pas par `require()` : choix delibere,
// motif complet a `SOURCE_DU_FILS`. Ne pas le remplacer.
const lanceCommeImport = (maison) => spawnSync(process.execPath, ['-e', SOURCE_DU_FILS], options(maison));

test('G1 : lance comme un script, la branche de point d entree s execute et parle', () => {
  const maison = homeJetable();
  try {
    // `--check` est le mode qui N ECRIT PAS (mesure) : ce test n a besoin que
    // de la sortie, pas d une installation.
    const r = lanceCommeScript(['--user', '--check'], maison);
    assert.equal(r.error, undefined, `le fils n a pas demarre : ${r.error}`);

    // On lit la SORTIE, pas le code de retour : `--check` sort en 1 quand les
    // crochets ne sont pas installes (mesure), ce qui est le cas d un home neuf.
    assert.ok(
      r.stdout.includes(SEULE_LA_BRANCHE_GARDEE),
      `la sortie doit porter ${JSON.stringify(SEULE_LA_BRANCHE_GARDEE)}\n`
      + `stdout=${JSON.stringify(r.stdout)}\nstderr=${JSON.stringify(r.stderr)}`,
    );

    // Et cette sortie doit venir du home DETOURNE. Sans ce controle, un test
    // vert pourrait etre un test qui vient de lire le vrai `~/.claude`. On
    // compare sur le suffixe aleatoire du dossier, insensible a la casse : le
    // prefixe du chemin, lui, peut etre normalise par l OS.
    const marqueur = path.basename(maison).toLowerCase();
    assert.ok(
      r.stdout.toLowerCase().includes(marqueur),
      `la sortie doit citer le home jetable (${marqueur}) ; stdout=${JSON.stringify(r.stdout)}`,
    );
  } finally {
    efface(maison);
  }
});

test('G2 : importe, le module se tait — sortie 0, rien sur stdout ni stderr, rien sur le disque', () => {
  const maison = homeJetable();
  try {
    // ASSIETTE : sans elle, un « aucun fichier ecrit » final ne prouverait rien.
    assert.deepEqual(fichiersSous(maison), [], 'le home jetable doit partir vide');

    const r = lanceCommeImport(maison);
    assert.equal(r.error, undefined, `le fils n a pas demarre : ${r.error}`);

    // stderr et le code de sortie D ABORD. Un chargement qui ECHOUE parle sur
    // stderr et sort en non-zero ; un test qui n observerait que stdout lirait
    // « aucune sortie » et passerait — un silence de panne se lirait comme un
    // silence de bonne conduite. C est ici que la traduction en ESM doit mordre.
    // L echec vise est celui d un module REELLEMENT incapable de se charger
    // (ERR_MODULE_NOT_FOUND). ERR_REQUIRE_ASYNC_MODULE, lui, ne doit JAMAIS
    // apparaitre ici : il signalerait qu on a remplace l `import()` de
    // `SOURCE_DU_FILS` par un `require()` — c est-a-dire desarme le filet.
    assert.equal(r.stderr, '', `stderr doit etre vide, recu : ${r.stderr}`);
    assert.equal(r.status, 0, `le fils doit sortir en 0, recu : ${r.status}`);
    assert.equal(r.stdout, '', `stdout doit etre vide, recu : ${r.stdout}`);

    // Le bord le plus couteux : la garde toujours vraie ecrit un
    // `.claude/settings.json` sous le home.
    assert.deepEqual(
      fichiersSous(maison), [],
      'un simple import ne doit ecrire aucun fichier sous le home',
    );
  } finally {
    efface(maison);
  }
});

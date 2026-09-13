// Doc/49, tâche 4, geste 3 — la garde de `dist/server/` que `bin/agent-viz.js`
// applique une seule fois, avant que la commande ne se branche (dix sites
// d'appel plus bas : cmdStart, cmdStop, cmdStatus, cmdInstallHooks,
// cmdUninstallHooks, cmdHook — tous chargent `dist/server/*.js`).
//
// Deux pannes, deux tests, un fichier : les deux fabriquent un arbre
// temporaire hors dépôt (`bin/agent-viz.js` copié + un `package.json` minimal)
// et lisent la SORTIE d'un vrai sous-processus — jamais un import direct de
// `ensureBuildIsFresh`, qui n'est pas exportée : c'est l'utilisateur final qui
// la voit, à l'écran, jamais un test qui l'invoquerait en boîte blanche.
//
//   1. `dist/server/` absent (dépôt cloné, jamais construit) : AVANT ce
//      geste, le premier `import()` de `bin/agent-viz.js` levait `Cannot find
//      module '…\dist\server\lifecycle.js'` — dix lignes de pile, aucune
//      mention du remède. Après : un message qui nomme `npm run build`,
//      jamais « Cannot find module », et le processus s'arrête (exit 1).
//   2. `dist/server/` présent mais périmé par rapport à la source (`tsc -b`
//      ÉMET MALGRÉ L'ERREUR — mesuré, tsc 5.9.3, exit 1 et fichiers réécrits
//      quand même) : AVANT ce geste, rien n'était dit, le serveur démarrait
//      et servait l'ancien code en silence. Après : un avertissement qui
//      nomme `npm run build`, non fatal — la commande continue.
//
// Un troisième test tient le CONTRÔLE INVERSE : sur un arbre construit et à
// jour, aucun des deux messages ne doit apparaître. Sans lui, une garde de
// build périmé trop large se déclencherait sur un arbre sain — le produit
// deviendrait inutilisable au moindre écart d'horloge du système de fichiers.
//
// La commande sondée n'est JAMAIS `start` : elle écrirait dans un vrai
// `.claude`/`.copilot` (interdit absolu de ce chantier). On sonde avec un nom
// de commande inconnu (`sonde-inexistante`) : `ensureBuildIsFresh` s'exécute
// AVANT le `switch`, quel que soit `cmd` — l'inconnu tombe ensuite dans le
// `default:` du dispatcher, qui n'importe plus rien sous `dist/server/` et ne
// touche donc jamais l'un des dix sites, ce qui laisse la garde seule en cause
// dans la sortie lue ici.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const BIN_REEL = path.join(ROOT, 'bin', 'agent-viz.js');
const PREFIXE = 'agent-viz-buildguard-';
const SONDE = 'sonde-inexistante';

// Base commune aux trois arbres : `bin/agent-viz.js` copié (jamais le vrai
// dépôt comme `cwd`) + un `package.json` minimal pour que la lecture de
// version au sommet du script ne lève pas.
function arbreDeBase() {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), PREFIXE));
  fs.mkdirSync(path.join(racine, 'bin'), { recursive: true });
  fs.copyFileSync(BIN_REEL, path.join(racine, 'bin', 'agent-viz.js'));
  fs.writeFileSync(path.join(racine, 'package.json'), JSON.stringify({ name: 'sonde-build-guard', version: '0.0.0' }));
  return racine;
}

// Panne 1 — aucun `dist/` du tout : le cas « cloné, jamais construit ».
function arbreSansDist() {
  return arbreDeBase();
}

// Pose `dist/server/` + `src/server/` avec les deux mtimes donnés sur le
// témoin de compilation et la source la plus récente — factorisé parce que
// la panne 2 et le contrôle inverse ne diffèrent que par l'ORDRE des dates.
function arbreAvecDatage(mtimeTemoin, mtimeSource) {
  const racine = arbreDeBase();
  fs.mkdirSync(path.join(racine, 'dist', 'server'), { recursive: true });
  fs.mkdirSync(path.join(racine, 'src', 'server'), { recursive: true });
  const temoin = path.join(racine, 'dist', 'tsconfig.build.tsbuildinfo');
  const source = path.join(racine, 'src', 'server', 'sonde.ts');
  fs.writeFileSync(temoin, '{}');
  fs.writeFileSync(source, 'export {};');
  fs.utimesSync(temoin, mtimeTemoin, mtimeTemoin);
  fs.utimesSync(source, mtimeSource, mtimeSource);
  return racine;
}

// Panne 2 — témoin de compilation ANTIDATÉ par rapport à la source la plus
// récente : le cas « construit une fois, puis la source a bougé ».
function arbrePerime() {
  return arbreAvecDatage(new Date('2000-01-01T00:00:00Z'), new Date('2030-01-01T00:00:00Z'));
}

// Contrôle inverse — témoin POSTÉRIEUR à la source : un `npm run build` tout
// juste rejoué, l'état visé par une commande normale sur ce dépôt.
function arbreSain() {
  return arbreAvecDatage(new Date('2030-01-01T00:00:00Z'), new Date('2000-01-01T00:00:00Z'));
}

// Sous-processus réel, home jetable — jamais le processus de test lui-même
// (deux raisons mesurées ailleurs dans ce dossier : effets de bord au
// chargement, exécuteurs qui lancent plusieurs fichiers en parallèle).
function lance(racine) {
  return spawnSync(process.execPath, [path.join(racine, 'bin', 'agent-viz.js'), SONDE], {
    cwd: racine,
    encoding: 'utf8',
    env: {
      ...process.env,
      USERPROFILE: racine,
      HOME: racine,
      TEMP: racine,
      TMP: racine,
      AGENT_VIZ_PORT: '59999',
    },
  });
}

function nettoie(racine) {
  // Garde-fou : on ne supprime que ce qu'on vient de fabriquer.
  if (racine && racine.includes(PREFIXE)) fs.rmSync(racine, { recursive: true, force: true });
}

test('dist/server absent : le message nomme `npm run build`, jamais « Cannot find module », et arrête (exit 1)', () => {
  const racine = arbreSansDist();
  try {
    const r = lance(racine);
    const sortie = `${r.stdout}${r.stderr}`;
    assert.ok(r.error === undefined, `le sous-processus n'a pas démarré : ${r.error}`);
    assert.ok(sortie.includes('npm run build'),
      `dist/server absent devrait nommer le remède (npm run build) :\n${sortie}`);
    assert.ok(!sortie.includes('Cannot find module'),
      `la garde ne doit jamais laisser voir l'échec brut du import() sous-jacent :\n${sortie}`);
    assert.equal(r.status, 1, `code de sortie attendu 1 (arrêt avant le dispatcher), obtenu ${r.status} :\n${sortie}`);
  } finally {
    nettoie(racine);
  }
});

test('dist/server périmé par rapport à src/ : un avertissement nomme `npm run build`, non fatal', () => {
  const racine = arbrePerime();
  try {
    const r = lance(racine);
    const sortie = `${r.stdout}${r.stderr}`;
    assert.ok(sortie.includes('npm run build'),
      `un témoin de compilation antidaté devrait avertir et nommer le remède (npm run build) :\n${sortie}`);
  } finally {
    nettoie(racine);
  }
});

test('contrôle inverse — arbre construit et à jour : aucun message de garde de build', () => {
  const racine = arbreSain();
  try {
    const r = lance(racine);
    const sortie = `${r.stdout}${r.stderr}`;
    assert.ok(!sortie.includes('npm run build'),
      `un arbre construit et à jour ne doit déclencher aucun message de build (faux positif) :\n${sortie}`);
  } finally {
    nettoie(racine);
  }
});

// Le marqueur ESM de `dist/engine/`, ecrit par le build (doc/38, etape 2, D3).
// Avant la fusion, `netgain/package.json` etait un fichier VERSIONNE ; apres,
// son equivalent `dist/engine/package.json` est GENERE. Ce module est le seul
// endroit qui sait ecrire ce marqueur, et il refuse de mentir dans les deux cas
// ou l ecrire serait un faux : dossier absent, ou emission CommonJS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeDistEsmMarker } from '../../scripts/dist-esm-marker.mjs';

// `os.tmpdir()` depuis Node : la variable d environnement TMPDIR est vide sur
// cette machine (mesure), s y fier fabriquerait des chemins relatifs.
const neuf = () => mkdtempSync(path.join(os.tmpdir(), 'dist-esm-marker-'));

const semerDist = (racine, contenuCli) => {
  const dir = path.join(racine, 'dist', 'engine');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'cli.js'), contenuCli);
  return dir;
};

test('le marqueur est ecrit avec type: module', () => {
  const racine = neuf();
  try {
    const dir = semerDist(racine, 'export const version = "0.13.0";\n');
    writeDistEsmMarker(racine);
    const lu = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
    assert.equal(lu.type, 'module');
  } finally {
    rmSync(racine, { recursive: true, force: true });
  }
});

test('un dist/engine absent fait lever en nommant le dossier', () => {
  const racine = neuf();
  try {
    assert.throws(() => writeDistEsmMarker(racine), /dist[\\/]engine/);
  } finally {
    rmSync(racine, { recursive: true, force: true });
  }
});

test('un cli.js en CommonJS fait lever en nommant le format', () => {
  const racine = neuf();
  try {
    // Le `require(` n arrive qu apres 39 lignes de helpers sous une emission
    // ES5 : le controle balaie TOUT le fichier, pas sa tete.
    semerDist(racine, `${'// remplissage\n'.repeat(39)}const fs = require("node:fs");\n`);
    assert.throws(() => writeDistEsmMarker(racine), /CommonJS/);
  } finally {
    rmSync(racine, { recursive: true, force: true });
  }
});

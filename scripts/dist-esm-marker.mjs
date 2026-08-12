// Ecrit `dist/engine/package.json` = {"type":"module"} — le marqueur sans lequel
// Node refuse de charger les `.js` ESM emis par `tsc` sous une racine CommonJS.
//
// Pourquoi il existe (doc/38, etape 2, D3/D6). Avant la fusion, le marqueur etait
// `netgain/package.json`, un fichier VERSIONNE. Apres, `dist/` est genere et
// git-ignore : l invariant devient une dependance d ordre d execution. Ce module
// est le SEUL endroit qui sait ecrire ce marqueur.
//
// Il leve — en nommant — dans les deux cas ou ecrire le marqueur serait un
// mensonge : dossier absent, ou emission CommonJS. Il ne couvre PAS le cas
// « tsc en echec » : le `&&` du script `build` court-circuite et ce script ne
// tourne alors jamais. Le filet y est le code de sortie de `tsc`, plus la sonde
// `node dist/engine/cli.js --version`.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const RACINE_DEPOT = path.resolve(import.meta.dirname, '..');

export function writeDistEsmMarker(racine = RACINE_DEPOT) {
  const dossier = path.join(racine, 'dist', 'engine');
  if (!existsSync(dossier)) {
    throw new Error(`marqueur ESM : ${dossier} est absent — lancer le build avant d ecrire le marqueur`);
  }
  const cli = path.join(dossier, 'cli.js');
  const code = readFileSync(cli, 'utf8');
  // Balayage de TOUT le fichier, pas de sa tete : sous une emission ES5, le
  // premier `require(` n arrive qu en ligne 40, derriere 39 lignes de helpers.
  if (/\brequire\(/.test(code) || /\bexports\./.test(code)) {
    throw new Error(`marqueur ESM : ${cli} est du CommonJS (require( ou exports. present) — l emission attendue est de l ESM`);
  }
  const marqueur = path.join(dossier, 'package.json');
  writeFileSync(marqueur, `${JSON.stringify({ type: 'module' }, null, 2)}\n`);
  return marqueur;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  console.log(writeDistEsmMarker());
}

// Bac jetable pour lancer bin/agent-viz.js en vrai sous-processus : copie du
// binaire, package.json minimal, HOME/USERPROFILE/TEMP/TMP pointés sur le bac.
// Rien de ce qui tourne ici n'atteint le vrai ~/.claude ni le vrai port 3333.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const BIN_REEL = path.join(ROOT, 'bin', 'agent-viz.js');
const PREFIXE_COMMUN = 'agent-viz-';

// Les six fichiers que la garde exige réellement (miroir de
// REQUIRED_DIST_FILES dans bin/agent-viz.js), relatifs à dist/.
export const REQUIS = [
  'server/lifecycle.js',
  'server/install-hooks.js',
  'server/prompt-install.js',
  'server/hook.js',
  'engine/core/index.js',
  'engine/doctor/index.js',
];

// `bom` préfixe package.json du caractère qu'ajoutent certains éditeurs Windows ;
// `sansPackageJson` simule une installation dont ce fichier a disparu.
export function nouvelleRacine(prefixe, { version = '0.0.0', bom = false, sansPackageJson = false } = {}) {
  if (!prefixe.startsWith(PREFIXE_COMMUN)) throw new Error(`préfixe de bac inattendu : ${prefixe}`);
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), prefixe));
  fs.mkdirSync(path.join(racine, 'bin'), { recursive: true });
  fs.copyFileSync(BIN_REEL, path.join(racine, 'bin', 'agent-viz.js'));
  if (!sansPackageJson) {
    const contenu = JSON.stringify({ name: 'sonde-agent-viz', version, type: 'module' });
    fs.writeFileSync(path.join(racine, 'package.json'), bom ? `﻿${contenu}` : contenu);
  }
  return racine;
}

// Écrit sous dist/ les fichiers compilés requis, sauf ceux de `omettre`.
// `contenus` remplace le corps d'un fichier (clé relative à dist/, par exemple
// 'server/hook.js') ; les autres exportent un module vide.
export function ecrireDist(racine, { omettre = [], contenus = {} } = {}) {
  for (const rel of REQUIS) {
    if (omettre.includes(rel)) continue;
    const p = path.join(racine, 'dist', ...rel.split('/'));
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, contenus[rel] ?? 'export {};');
  }
}

// `input: ''` ferme stdin tout de suite : une commande qui lirait l'entrée
// standard (hook, invite interactive) ne reste jamais suspendue.
export function lance(racine, argv) {
  return spawnSync(process.execPath, [path.join(racine, 'bin', 'agent-viz.js'), ...argv], {
    cwd: racine,
    encoding: 'utf8',
    input: '',
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

// Tous les fichiers du bac, en chemins relatifs séparés par `/`, triés.
export function fichiersDe(racine) {
  return fs.readdirSync(racine, { recursive: true })
    .map(rel => String(rel))
    .filter(rel => fs.statSync(path.join(racine, rel)).isFile())
    .map(rel => rel.split(path.sep).join('/'))
    .sort();
}

export function nettoie(racine) {
  // Garde-fou : on ne supprime qu'un bac fabriqué par nouvelleRacine.
  if (racine && path.basename(racine).startsWith(PREFIXE_COMMUN) && path.dirname(racine) === os.tmpdir()) {
    fs.rmSync(racine, { recursive: true, force: true });
  }
}

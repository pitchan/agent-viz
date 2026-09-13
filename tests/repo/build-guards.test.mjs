// Verifie ce que voit process.stdout/stderr quand bin/agent-viz.js tourne sur
// un arbre synthetique hors depot : fichier compile manquant (depot dev ou
// paquet installe), temoin de compilation absent ou perime, commande hook.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const BIN_REEL = path.join(ROOT, 'bin', 'agent-viz.js');
const PREFIXE = 'agent-viz-buildguard-';
// Nom de commande inconnu : `ensureBuildIsFresh` tourne avant le `switch`
// quel que soit `cmd`, et l'inconnu tombe dans le `default:` du dispatcher,
// qui n'importe plus rien sous dist/server — seule la garde peut donc
// expliquer ce qui precede cette ligne dans la sortie.
const SONDE = 'sonde-inexistante';

const T_VIEUX = new Date('2000-01-01T00:00:00Z');
const T_MOYEN = new Date('2015-01-01T00:00:00Z');
const T_RECENT = new Date('2030-01-01T00:00:00Z');

// Les six fichiers que la garde exige reellement (miroir de
// REQUIRED_DIST_FILES dans bin/agent-viz.js), relatifs a dist/.
const REQUIS = [
  ['server', 'lifecycle.js'],
  ['server', 'install-hooks.js'],
  ['server', 'prompt-install.js'],
  ['server', 'hook.js'],
  ['engine', 'core', 'index.js'],
  ['engine', 'doctor', 'index.js'],
];

function nouvelleRacine() {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), PREFIXE));
  fs.mkdirSync(path.join(racine, 'bin'), { recursive: true });
  fs.copyFileSync(BIN_REEL, path.join(racine, 'bin', 'agent-viz.js'));
  fs.writeFileSync(path.join(racine, 'package.json'), JSON.stringify({ name: 'sonde-build-guard', version: '0.0.0' }));
  return racine;
}

// `src/server/` present suffit a se faire reconnaitre comme depot de
// developpement par la garde (elle ne regarde que son existence).
function ecrireDepotDev(racine) {
  fs.mkdirSync(path.join(racine, 'src', 'server'), { recursive: true });
}

// Ecrit les six fichiers compiles requis sous `dist/`, sauf ceux listes dans
// `omettre` (chemins relatifs, ex. 'engine/doctor/index.js'). `hookContent`
// remplace le contenu par defaut de dist/server/hook.js, pour la commande
// `hook` qui, seule parmi les six, est vraiment chargee par les tests ici.
function ecrireDist(racine, { omettre = [], hookContent } = {}) {
  for (const segs of REQUIS) {
    const rel = segs.join('/');
    if (omettre.includes(rel)) continue;
    const p = path.join(racine, 'dist', ...segs);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, rel === 'server/hook.js' && hookContent ? hookContent : 'export {};');
  }
}

// Un `.ts` sonde sous src/<sousDir>/, date a `mtime` — sert a positionner la
// source la plus recente vue par le balayage de peremption.
function ecrireSourceTs(racine, sousDir, mtime) {
  const dir = path.join(racine, 'src', sousDir);
  fs.mkdirSync(dir, { recursive: true });
  const fichier = path.join(dir, 'sonde.ts');
  fs.writeFileSync(fichier, 'export {};');
  fs.utimesSync(fichier, mtime, mtime);
}

function ecrireTemoin(racine, mtime) {
  const p = path.join(racine, 'dist', 'tsconfig.build.tsbuildinfo');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, '{}');
  fs.utimesSync(p, mtime, mtime);
}

// Sous-processus reel, home jetable (jamais `agent-viz start`, jamais
// ~/.claude reel) — `input: ''` ferme stdin tout de suite, au cas ou le
// chemin sonde lirait un jour l'entree standard.
function lance(racine, argv = [SONDE]) {
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

function nettoie(racine) {
  // Garde-fou : on ne supprime que ce qu'on vient de fabriquer.
  if (racine && racine.includes(PREFIXE)) fs.rmSync(racine, { recursive: true, force: true });
}

test('fichier compile manquant, depot de dev : exit 1, message nommant `npm run build`, jamais « Cannot find module »', () => {
  const racine = nouvelleRacine();
  try {
    ecrireDepotDev(racine);
    ecrireDist(racine, { omettre: ['server/lifecycle.js'] });
    const r = lance(racine);
    const sortie = `${r.stdout}${r.stderr}`;
    assert.ok(r.error === undefined, `le sous-processus n'a pas demarre : ${r.error}`);
    assert.ok(sortie.includes('npm run build'),
      `depot de dev, fichier compile manquant : devrait nommer le remede (npm run build) :\n${sortie}`);
    assert.ok(!sortie.includes('Cannot find module'),
      `la garde ne doit jamais laisser voir l'echec brut du import() sous-jacent :\n${sortie}`);
    assert.equal(r.status, 1, `code de sortie attendu 1, obtenu ${r.status} :\n${sortie}`);
  } finally {
    nettoie(racine);
  }
});

test('dist/server complet mais un fichier de dist/engine manquant : meme arret que dist/server absent', () => {
  const racine = nouvelleRacine();
  try {
    ecrireDepotDev(racine);
    ecrireDist(racine, { omettre: ['engine/doctor/index.js'] });
    const r = lance(racine);
    const sortie = `${r.stdout}${r.stderr}`;
    assert.ok(sortie.includes('npm run build'),
      `dist/server complet mais dist/engine incomplet : devrait quand meme nommer le remede :\n${sortie}`);
    assert.ok(!sortie.includes('Cannot find module'), `pas d'echec brut attendu ici :\n${sortie}`);
    assert.equal(r.status, 1, `code de sortie attendu 1, obtenu ${r.status} :\n${sortie}`);
  } finally {
    nettoie(racine);
  }
});

test('fichier compile manquant, paquet installe (pas de src/server) : exit 1, message Reinstall, jamais `npm run build`', () => {
  const racine = nouvelleRacine();
  try {
    // Pas d'appel a ecrireDepotDev : src/server absent, comme un paquet installe.
    ecrireDist(racine, { omettre: ['server/lifecycle.js'] });
    const r = lance(racine);
    const sortie = `${r.stdout}${r.stderr}`;
    assert.ok(/reinstall/i.test(sortie),
      `paquet installe, fichier compile manquant : devrait orienter vers une reinstallation :\n${sortie}`);
    assert.ok(!sortie.includes('npm run build'),
      `un paquet installe n'a pas de source ni de script build a proposer :\n${sortie}`);
    assert.equal(r.status, 1, `code de sortie attendu 1, obtenu ${r.status} :\n${sortie}`);
  } finally {
    nettoie(racine);
  }
});

test('un .ts de src/server plus recent que le temoin : avertissement, et la commande continue (son propre exit, pas 1)', () => {
  const racine = nouvelleRacine();
  try {
    ecrireDepotDev(racine);
    ecrireDist(racine);
    ecrireTemoin(racine, T_VIEUX);
    ecrireSourceTs(racine, 'server', T_RECENT);
    const r = lance(racine);
    assert.ok(r.stderr.includes('changed after the last'),
      `un .ts de src/server plus recent que le temoin devrait avertir :\n${r.stderr}`);
    assert.ok(r.stderr.includes('Unknown command'),
      `la commande sondee devrait quand meme s'executer apres l'avertissement :\n${r.stderr}`);
    assert.ok(r.stderr.indexOf('changed after the last') < r.stderr.indexOf('Unknown command'),
      `l'avertissement doit preceder la sortie propre de la commande :\n${r.stderr}`);
    assert.equal(r.status, 2, `code de sortie attendu 2 (celui du dispatcher sur commande inconnue), obtenu ${r.status}`);
  } finally {
    nettoie(racine);
  }
});

test('seul un .ts de src/web plus recent que le temoin : aucun avertissement (src/web n\'est jamais compile)', () => {
  const racine = nouvelleRacine();
  try {
    ecrireDepotDev(racine);
    ecrireDist(racine);
    ecrireTemoin(racine, T_MOYEN);
    ecrireSourceTs(racine, 'server', T_VIEUX);
    ecrireSourceTs(racine, 'web', T_RECENT);
    const r = lance(racine);
    assert.ok(!r.stderr.includes('changed after the last'),
      `src/web n'est jamais compile : un .ts plus recent la-dedans ne doit rien declencher :\n${r.stderr}`);
    assert.ok(r.stderr.includes('Unknown command'), `la commande sondee devrait s'executer normalement :\n${r.stderr}`);
  } finally {
    nettoie(racine);
  }
});

test('commande `hook` sur un arbre perime : aucune ligne de garde', () => {
  const racine = nouvelleRacine();
  try {
    ecrireDepotDev(racine);
    ecrireDist(racine, { hookContent: "export function runHook() { console.log('SONDE_HOOK_OK'); }\n" });
    ecrireTemoin(racine, T_VIEUX);
    ecrireSourceTs(racine, 'server', T_RECENT);
    const r = lance(racine, ['hook']);
    const sortie = `${r.stdout}${r.stderr}`;
    assert.ok(sortie.includes('SONDE_HOOK_OK'),
      `le hook stub devrait s'executer normalement, sans etre bloque par la garde :\n${sortie}`);
    assert.ok(!sortie.includes('changed after the last'),
      `la commande hook ne doit jamais imprimer l'avertissement de peremption :\n${sortie}`);
    assert.equal(r.status, 0, `code de sortie attendu 0, obtenu ${r.status} :\n${sortie}`);
  } finally {
    nettoie(racine);
  }
});

test('temoin de compilation absent, fichiers compiles presents, depot de dev : avertissement « can\'t tell »', () => {
  const racine = nouvelleRacine();
  try {
    ecrireDepotDev(racine);
    ecrireDist(racine);
    // Pas d'appel a ecrireTemoin : dist/tsconfig.build.tsbuildinfo n'existe pas.
    const r = lance(racine);
    assert.ok(r.stderr.includes("can't tell"),
      `temoin absent : devrait avertir qu'aucune mesure de fraicheur n'est possible :\n${r.stderr}`);
    assert.ok(r.stderr.includes('Unknown command'), `la commande sondee devrait quand meme s'executer :\n${r.stderr}`);
  } finally {
    nettoie(racine);
  }
});

test('controle inverse : arbre construit et a jour, aucun message de garde', () => {
  const racine = nouvelleRacine();
  try {
    ecrireDepotDev(racine);
    ecrireDist(racine);
    ecrireTemoin(racine, T_RECENT);
    ecrireSourceTs(racine, 'server', T_VIEUX);
    const r = lance(racine);
    const sortie = `${r.stdout}${r.stderr}`;
    assert.ok(!sortie.includes('npm run build'), `arbre a jour : aucun message de build ne devrait apparaitre :\n${sortie}`);
    assert.ok(!sortie.includes("can't tell"), `le temoin existe : pas d'avertissement « can't tell » attendu :\n${sortie}`);
    assert.ok(sortie.includes('Unknown command'), `la commande sondee devrait s'executer normalement :\n${sortie}`);
  } finally {
    nettoie(racine);
  }
});

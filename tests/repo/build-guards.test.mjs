// Verifie ce que voit process.stdout/stderr quand bin/agent-viz.js tourne sur
// un arbre synthetique hors depot : fichier compile manquant (depot dev ou
// paquet installe), temoin de compilation absent ou perime, commande hook.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { nouvelleRacine, ecrireDist, lance, nettoie, REQUIS } from '../helpers/bin-sandbox.ts';
import { CLI_PAR_DEFAUT } from '../helpers/cli-defaut-stub.ts';

const PREFIXE = 'agent-viz-buildguard-';
// Commande inconnue : `ensureBuildIsFresh` tourne avant le `switch`, et le `default:`
// du dispatcher n'importe rien sous dist/ — seule la garde peut donc expliquer
// ce qui precede « Unknown command » dans la sortie.
const SONDE = 'sonde-inexistante';

const T_VIEUX = new Date('2000-01-01T00:00:00Z');
const T_MOYEN = new Date('2015-01-01T00:00:00Z');
const T_RECENT = new Date('2030-01-01T00:00:00Z');

// `src/server/` present suffit a se faire reconnaitre comme depot de
// developpement par la garde (elle ne regarde que son existence).
function ecrireDepotDev(racine) {
  fs.mkdirSync(path.join(racine, 'src', 'server'), { recursive: true });
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

test('fichier compile manquant, depot de dev : exit 1, message nommant `npm run build`, jamais « Cannot find module »', () => {
  const racine = nouvelleRacine(PREFIXE);
  try {
    ecrireDepotDev(racine);
    ecrireDist(racine, { omettre: ['server/lifecycle.js'] });
    const r = lance(racine, [SONDE]);
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
  const racine = nouvelleRacine(PREFIXE);
  try {
    ecrireDepotDev(racine);
    ecrireDist(racine, { omettre: ['engine/doctor/index.js'] });
    const r = lance(racine, [SONDE]);
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
  const racine = nouvelleRacine(PREFIXE);
  try {
    // Pas d'appel a ecrireDepotDev : src/server absent, comme un paquet installe.
    ecrireDist(racine, { omettre: ['server/lifecycle.js'] });
    const r = lance(racine, [SONDE]);
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
  const racine = nouvelleRacine(PREFIXE);
  try {
    ecrireDepotDev(racine);
    ecrireDist(racine);
    ecrireTemoin(racine, T_VIEUX);
    ecrireSourceTs(racine, 'server', T_RECENT);
    const r = lance(racine, [SONDE]);
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
  const racine = nouvelleRacine(PREFIXE);
  try {
    ecrireDepotDev(racine);
    ecrireDist(racine);
    ecrireTemoin(racine, T_MOYEN);
    ecrireSourceTs(racine, 'server', T_VIEUX);
    ecrireSourceTs(racine, 'web', T_RECENT);
    const r = lance(racine, [SONDE]);
    assert.ok(!r.stderr.includes('changed after the last'),
      `src/web n'est jamais compile : un .ts plus recent la-dedans ne doit rien declencher :\n${r.stderr}`);
    assert.ok(r.stderr.includes('Unknown command'), `la commande sondee devrait s'executer normalement :\n${r.stderr}`);
  } finally {
    nettoie(racine);
  }
});

test('commande `hook` sur un arbre perime : aucune ligne de garde', () => {
  const racine = nouvelleRacine(PREFIXE);
  try {
    ecrireDepotDev(racine);
    ecrireDist(racine, {
      contenus: {
        'server/hook.js': "export function runHook() { console.log('SONDE_HOOK_OK'); }\n",
        'server/cli.js': "import { pathToFileURL } from 'node:url';\nimport path from 'node:path';\n"
          + "export async function cmdHook(packageRoot) {\n"
          + "  const { runHook } = await import(pathToFileURL(path.join(packageRoot, 'dist', 'server', 'hook.js')).href);\n"
          + "  runHook();\n"
          + "}\n",
      },
    });
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
  const racine = nouvelleRacine(PREFIXE);
  try {
    ecrireDepotDev(racine);
    ecrireDist(racine);
    // Pas d'appel a ecrireTemoin : dist/tsconfig.build.tsbuildinfo n'existe pas.
    const r = lance(racine, [SONDE]);
    assert.ok(r.stderr.includes("can't tell"),
      `temoin absent : devrait avertir qu'aucune mesure de fraicheur n'est possible :\n${r.stderr}`);
    assert.ok(r.stderr.includes('Unknown command'), `la commande sondee devrait quand meme s'executer :\n${r.stderr}`);
  } finally {
    nettoie(racine);
  }
});

test('controle inverse : arbre construit et a jour, aucun message de garde', () => {
  const racine = nouvelleRacine(PREFIXE);
  try {
    ecrireDepotDev(racine);
    ecrireDist(racine);
    ecrireTemoin(racine, T_RECENT);
    ecrireSourceTs(racine, 'server', T_VIEUX);
    const r = lance(racine, [SONDE]);
    const sortie = `${r.stdout}${r.stderr}`;
    assert.ok(!sortie.includes('npm run build'), `arbre a jour : aucun message de build ne devrait apparaitre :\n${sortie}`);
    assert.ok(!sortie.includes("can't tell"), `le temoin existe : pas d'avertissement « can't tell » attendu :\n${sortie}`);
    assert.ok(sortie.includes('Unknown command'), `la commande sondee devrait s'executer normalement :\n${sortie}`);
  } finally {
    nettoie(racine);
  }
});

test('dist/server/server.js manquant : la garde arrete, sans laisser voir « Cannot find module »', () => {
  // Arrange
  const racine = nouvelleRacine(PREFIXE);
  try {
    ecrireDepotDev(racine);
    ecrireDist(racine, { omettre: ['server/server.js'] });

    // Act
    const r = lance(racine, [SONDE]);

    // Assert
    const sortie = `${r.stdout}${r.stderr}`;
    assert.ok(sortie.includes('npm run build'),
      `demon absent : la garde devrait nommer le remede plutot que laisser le spawn echouer plus tard :\n${sortie}`);
    assert.ok(!sortie.includes('Cannot find module'),
      `sans server.js dans la liste, l'echec ne se voyait qu'en queue de journal :\n${sortie}`);
    assert.equal(r.status, 1, `code de sortie attendu 1, obtenu ${r.status} :\n${sortie}`);
  } finally {
    nettoie(racine);
  }
});

// Le bac a sable recopie la liste de la garde a la main. Sans ce verrou, un
// fichier ajoute a REQUIRED_DIST_FILES reste absent de REQUIS et aucun test ne
// couvre son absence — c'est ainsi que server.js est passe inapercu.
test('la liste du bac a sable est le miroir exact de REQUIRED_DIST_FILES', () => {
  // Arrange
  const source = fs.readFileSync(
    path.join(import.meta.dirname, '..', '..', 'bin', 'agent-viz.js'), 'utf8');
  const bloc = source.split('const REQUIRED_DIST_FILES = [')[1]?.split('].map(')[0];
  assert.ok(bloc, 'REQUIRED_DIST_FILES introuvable dans bin/agent-viz.js');

  // Act
  const declares = [...bloc.matchAll(/\[([^\]]*)\]/g)]
    .map(m => [...m[1].matchAll(/'([^']+)'/g)].map(s => s[1]).join('/'));

  // Assert
  assert.deepEqual(declares, REQUIS,
    'REQUIS (tests/helpers/bin-sandbox.ts) doit lister exactement les memes fichiers que la garde');
});

// Meme famille de verrou que le precedent, pour le meme risque : cli-defaut-stub.mjs
// recopie a la main les exports de src/server/cli.ts (les bacs a sable doivent rester
// hermetiques, sans dependre d'un `npm run build` du vrai depot). Sans ce verrou, un export
// renomme ou retire dans cli.ts laisserait le stub silencieusement desynchronise, et seul
// un test comportemental qui tombe dessus par hasard le remarquerait.
test('le stub par defaut de dist/server/cli.js exporte exactement les memes fonctions que src/server/cli.ts', () => {
  // Arrange
  const sourceReelle = fs.readFileSync(
    path.join(import.meta.dirname, '..', '..', 'src', 'server', 'cli.ts'), 'utf8');
  const exportsReels = [...sourceReelle.matchAll(/^export async function (\w+)/gm)].map(m => m[1]);
  assert.ok(exportsReels.length > 0, 'aucun export trouve dans src/server/cli.ts : le motif de lecture a casse');

  // Act
  const exportsStub = [...CLI_PAR_DEFAUT.matchAll(/^export async function (\w+)/gm)].map(m => m[1]);

  // Assert
  assert.deepEqual(exportsStub, exportsReels,
    'cli-defaut-stub.mjs (tests/helpers/) doit exporter exactement les memes fonctions, dans le meme ordre, que src/server/cli.ts');
});

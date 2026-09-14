// Demander l'aide ou la version n'exécute rien : ni démon, ni hooks, ni témoin
// de bienvenue, ni garde de build. Le bac n'a pas de dist/ : une commande qui
// tournerait malgré l'option s'arrêterait sur la garde, et le test le verrait.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nouvelleRacine, lance, fichiersDe, nettoie } from '../helpers/bin-sandbox.mjs';

const PREFIXE = 'agent-viz-aide-';
const VERSION = '9.9.9-test';

const DEMANDES_D_AIDE = [
  ['--help'],
  ['-h'],
  ['help'],
  ['start', '--help'],
  ['start', '-h'],
  ['stop', '--help'],
  ['uninstall-hooks', '--help'],
  ['install-hooks', '--help'],
  ['status', '--help'],
  ['hook', '--help'],
  ['start', '--port', '4444', '--help'],
  ['install-hooks', '--user', '--target=both', '-h'],
  ['--help', '--version'],
  ['--version', '--help'],
];

const DEMANDES_DE_VERSION = [
  ['--version'],
  ['-v'],
  ['start', '--version'],
  ['stop', '-v'],
  ['install-hooks', '--user', '-v'],
  ['hook', '--version'],
];

for (const argv of DEMANDES_D_AIDE) {
  test(`agent-viz ${argv.join(' ')} : affiche l'aide, sort 0, n'écrit rien`, () => {
    // Arrange
    const racine = nouvelleRacine(PREFIXE, { version: VERSION });
    try {
      // Act
      const r = lance(racine, argv);

      // Assert
      const sortie = `${r.stdout}${r.stderr}`;
      assert.equal(r.status, 0, `code de sortie attendu 0, obtenu ${r.status} :\n${sortie}`);
      assert.ok(r.stdout.includes('Usage:') && r.stdout.includes(VERSION),
        `l'aide globale devrait s'afficher :\n${sortie}`);
      assert.equal(r.stderr, '', `rien ne devrait sortir sur stderr :\n${r.stderr}`);
      assert.deepEqual(fichiersDe(racine), ['bin/agent-viz.js', 'package.json'],
        'demander l\'aide ne doit écrire aucun fichier');
    } finally {
      nettoie(racine);
    }
  });
}

for (const argv of DEMANDES_DE_VERSION) {
  test(`agent-viz ${argv.join(' ')} : affiche la version, sort 0, n'écrit rien`, () => {
    // Arrange
    const racine = nouvelleRacine(PREFIXE, { version: VERSION });
    try {
      // Act
      const r = lance(racine, argv);

      // Assert
      const sortie = `${r.stdout}${r.stderr}`;
      assert.equal(r.status, 0, `code de sortie attendu 0, obtenu ${r.status} :\n${sortie}`);
      assert.equal(r.stdout, `${VERSION}\n`, `seule la version devrait s'afficher :\n${sortie}`);
      assert.equal(r.stderr, '', `rien ne devrait sortir sur stderr :\n${r.stderr}`);
      assert.deepEqual(fichiersDe(racine), ['bin/agent-viz.js', 'package.json'],
        'demander la version ne doit écrire aucun fichier');
    } finally {
      nettoie(racine);
    }
  });
}

test('package.json précédé d\'un BOM : --version affiche la version, sort 0, rien sur stderr', () => {
  // Arrange
  const racine = nouvelleRacine(PREFIXE, { version: VERSION, bom: true });
  try {
    // Act
    const r = lance(racine, ['--version']);

    // Assert
    const sortie = `${r.stdout}${r.stderr}`;
    assert.equal(r.status, 0, `code de sortie attendu 0, obtenu ${r.status} :\n${sortie}`);
    assert.equal(r.stdout, `${VERSION}\n`, `la version devrait se lire malgré le BOM :\n${sortie}`);
    assert.equal(r.stderr, '', `rien ne devrait sortir sur stderr :\n${r.stderr}`);
  } finally {
    nettoie(racine);
  }
});

test('package.json absent : --version échoue au lieu d\'afficher une version inventée', () => {
  // Arrange
  const racine = nouvelleRacine(PREFIXE, { sansPackageJson: true });
  try {
    // Act
    const r = lance(racine, ['--version']);

    // Assert
    const sortie = `${r.stdout}${r.stderr}`;
    assert.notEqual(r.status, 0, `un package.json absent ne doit pas passer pour un succès :\n${sortie}`);
    assert.ok(!r.stdout.includes('0.0.0'), `aucune version de repli ne doit s'afficher :\n${sortie}`);
    assert.match(r.stderr, /package\.json/, `l'échec doit nommer package.json :\n${sortie}`);
  } finally {
    nettoie(racine);
  }
});

test('contrôle inverse : sans --help, la même commande atteint la garde de build et s\'arrête', () => {
  // Arrange
  const racine = nouvelleRacine(PREFIXE, { version: VERSION });
  try {
    // Act
    const r = lance(racine, ['start']);

    // Assert
    const sortie = `${r.stdout}${r.stderr}`;
    assert.equal(r.status, 1, `la garde de build devrait arrêter la commande :\n${sortie}`);
    assert.ok(/reinstall/i.test(r.stderr), `le message de la garde devrait sortir sur stderr :\n${sortie}`);
  } finally {
    nettoie(racine);
  }
});

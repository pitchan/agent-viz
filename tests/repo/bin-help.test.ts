// Demander l'aide ou la version n'exécute rien : ni démon, ni hooks, ni témoin
// de bienvenue, ni garde de build. Le bac n'a pas de dist/ : une commande qui
// tournerait malgré l'option s'arrêterait sur la garde, et le test le verrait.
import { expect, test } from 'vitest';
import { nouvelleRacine, lance, fichiersDe, nettoie } from '../helpers/bin-sandbox.ts';
import { TARGETS } from '../../src/server/install-hooks/registry.ts';

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
      expect(r.status, `code de sortie attendu 0, obtenu ${r.status} :\n${sortie}`).toBe(0);
      expect(r.stdout.includes('Usage:') && r.stdout.includes(VERSION), `l'aide globale devrait s'afficher :\n${sortie}`).toBeTruthy();
      expect(r.stderr, `rien ne devrait sortir sur stderr :\n${r.stderr}`).toBe('');
      expect(fichiersDe(racine), 'demander l\'aide ne doit écrire aucun fichier').toEqual(['bin/agent-viz.js', 'package.json']);
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
      expect(r.status, `code de sortie attendu 0, obtenu ${r.status} :\n${sortie}`).toBe(0);
      expect(r.stdout, `seule la version devrait s'afficher :\n${sortie}`).toBe(`${VERSION}\n`);
      expect(r.stderr, `rien ne devrait sortir sur stderr :\n${r.stderr}`).toBe('');
      expect(fichiersDe(racine), 'demander la version ne doit écrire aucun fichier').toEqual(['bin/agent-viz.js', 'package.json']);
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
    expect(r.status, `code de sortie attendu 0, obtenu ${r.status} :\n${sortie}`).toBe(0);
    expect(r.stdout, `la version devrait se lire malgré le BOM :\n${sortie}`).toBe(`${VERSION}\n`);
    expect(r.stderr, `rien ne devrait sortir sur stderr :\n${r.stderr}`).toBe('');
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
    expect(r.status, `un package.json absent ne doit pas passer pour un succès :\n${sortie}`).not.toBe(0);
    expect(!r.stdout.includes('0.0.0'), `aucune version de repli ne doit s'afficher :\n${sortie}`).toBeTruthy();
    expect(r.stderr, `l'échec doit nommer package.json :\n${sortie}`).toMatch(/package\.json/);
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
    expect(r.status, `la garde de build devrait arrêter la commande :\n${sortie}`).toBe(1);
    expect(/reinstall/i.test(r.stderr), `le message de la garde devrait sortir sur stderr :\n${sortie}`).toBeTruthy();
  } finally {
    nettoie(racine);
  }
});

// Le binaire porte sa propre copie des cibles valides : l'aide doit afficher
// celles du registre, qui fait foi.
test('miroir : l\'aide affiche les cibles de --target du registre', () => {
  // Arrange
  const racine = nouvelleRacine(PREFIXE, { version: VERSION });
  try {
    // Act
    const r = lance(racine, ['--help']);

    // Assert
    expect(r.status, `code de sortie attendu 0, obtenu ${r.status} :\n${r.stdout}${r.stderr}`).toBe(0);
    const attendu = `--target=${TARGETS.join('|')}`;
    expect(r.stdout.includes(attendu), `l'aide devrait afficher ${attendu} :\n${r.stdout}`).toBeTruthy();
  } finally {
    nettoie(racine);
  }
});

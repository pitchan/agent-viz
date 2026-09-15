// Le binaire imprime le chemin de chaque copie sous la ligne qui nomme le
// fichier changé, et rien quand aucune copie n'a été faite. Les modules de dist/
// sont factices : ils rendent une copie sonde ou `null`, sans toucher au disque.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nouvelleRacine, ecrireDist, lance, nettoie } from '../helpers/bin-sandbox.mjs';
import { BACKUPS_KEPT } from '../../src/server/install-hooks/backup.ts';

const PREFIXE = 'agent-viz-copie-';

const installHooksFactice = backup => [
  `const backup = ${JSON.stringify(backup)};`,
  "const target = { file: 'FICHIER-SONDE', scope: 'user', projectRoot: null };",
  'export function resolveScope() { return target; }',
  'export function install() {',
  "  return { claude: { target, action: 'installed', command: { command: 'COMMANDE-SONDE', mode: 'absolute' },",
  "    missing: ['Stop'], updated: [], present: [], coexisting: {}, gitignore: null, crossScope: [], backup } };",
  '}',
  'export function uninstall() { return { claude: { results: [{ ...target, removed: 1, exists: true, backup }] } }; }',
].join('\n');

const LIFECYCLE_FACTICE = [
  "export async function status() { return { running: true, port: 1, log: 'journal' }; }",
  'export async function stop() { return { stopped: true, port: 1 }; }',
  'export async function start() { return { alreadyRunning: true, pid: 1, port: 1 }; }',
].join('\n');

const COMMANDES = [
  { argv: ['start'], ligneDuFichier: 'scope: user, mode: absolute', ligneBackup: '  backup: SONDE-COPIE' },
  { argv: ['stop'], ligneDuFichier: 'Claude Code hooks removed', ligneBackup: '  backup: SONDE-COPIE' },
  { argv: ['install-hooks', '--user', '--target=claude'], ligneDuFichier: 'hook cmd : COMMANDE-SONDE', ligneBackup: '  backup   : SONDE-COPIE' },
  { argv: ['uninstall-hooks', '--target=claude'], ligneDuFichier: 'removed 1 from', ligneBackup: 'Claude Code:   backup: SONDE-COPIE' },
];

function bacQuiRend(backup) {
  const racine = nouvelleRacine(PREFIXE);
  ecrireDist(racine, { contenus: {
    'server/install-hooks.js': installHooksFactice(backup),
    'server/lifecycle.js': LIFECYCLE_FACTICE,
  } });
  return racine;
}

function ligneApres(sortie, fragment) {
  const lignes = sortie.split(/\r?\n/);
  const i = lignes.findIndex(ligne => ligne.includes(fragment));
  return i === -1 ? null : (lignes[i + 1] ?? null);
}

for (const { argv, ligneDuFichier, ligneBackup } of COMMANDES) {
  test(`agent-viz ${argv.join(' ')} : la ligne backup suit la ligne qui nomme le fichier changé`, () => {
    // Arrange
    const racine = bacQuiRend('SONDE-COPIE');
    try {
      // Act
      const r = lance(racine, argv);
      // Assert
      assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
      assert.ok((ligneApres(r.stdout, ligneDuFichier) ?? '').includes(ligneBackup),
        `« ${ligneBackup} » attendu juste sous « ${ligneDuFichier} » :\n${r.stdout}`);
    } finally {
      nettoie(racine);
    }
  });

  test(`agent-viz ${argv.join(' ')} : sans copie, aucune ligne ne parle de backup`, () => {
    // Arrange
    const racine = bacQuiRend(null);
    try {
      // Act
      const r = lance(racine, argv);
      // Assert
      assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
      assert.ok(r.stdout.includes(ligneDuFichier), `la ligne du fichier devait s'afficher :\n${r.stdout}`);
      assert.equal(r.stdout.includes('backup'), false, r.stdout);
    } finally {
      nettoie(racine);
    }
  });
}

// L'aide porte sa propre copie du nombre de copies gardées : elle doit dire
// celui du module, qui fait foi.
test('miroir : l\'aide annonce la copie des fichiers de hooks avec le nombre de copies que garde le module', () => {
  // Arrange
  const racine = nouvelleRacine(PREFIXE);
  try {
    // Act
    const r = lance(racine, ['--help']);
    // Assert
    const attendu = `Before changing or deleting a hooks file, agent-viz copies it to ~/.agent-viz/backups/ (last ${BACKUPS_KEPT} copies per file).`;
    assert.ok(r.stdout.includes(attendu), `l'aide devrait afficher « ${attendu} » :\n${r.stdout}`);
  } finally {
    nettoie(racine);
  }
});

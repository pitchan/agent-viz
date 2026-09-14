// Une option que la sous-commande ne déclare pas est refusée avant tout effet :
// une faute de frappe comme `stop --keep-hook` retirait les hooks sans un mot.
// `hook` n'est pas concerné : Claude Code bloque l'outil en cours sur un code 2.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { nouvelleRacine, ecrireDist, lance, nettoie, REQUIS } from '../helpers/bin-sandbox.mjs';
import { TARGETS } from '../../src/server/install-hooks/registry.ts';

const PREFIXE = 'agent-viz-options-';
const HOOK_SONDE = "export function runHook() { console.log('SONDE_HOOK_OK'); }\n";

// Chaque module factice de dist/ dépose un témoin à la racine du bac s'il est
// chargé : un refus doit arriver avant tout import, donc sans aucun témoin.
function ecrireDistAvecTemoins(racine, contenus = {}) {
  const temoins = Object.fromEntries(REQUIS.map(rel => {
    const versRacine = '../'.repeat(rel.split('/').length);
    const nom = `CHARGE-${rel.replaceAll('/', '-')}`;
    return [rel, `import fs from 'node:fs';\nfs.writeFileSync(new URL('${versRacine}${nom}', import.meta.url), '');\nexport {};\n`];
  }));
  ecrireDist(racine, { contenus: { ...temoins, ...contenus } });
}

function temoinsCharges(racine) {
  return fs.readdirSync(racine).filter(nom => nom.startsWith('CHARGE-')).sort();
}

const REFUS = [
  { argv: ['start', '--prot', '3000'], nomme: '--prot' },
  { argv: ['start', '--no-install-hook'], nomme: '--no-install-hook' },
  { argv: ['start', '--port'], nomme: '--port' },
  { argv: ['start', '3000'], nomme: '3000' },
  { argv: ['stop', '--keep-hook'], nomme: '--keep-hook' },
  { argv: ['install-hooks', '--user', '--targt=copilot'], nomme: '--targt' },
  { argv: ['status', '--json'], nomme: '--json' },
  // Une cible hors liste se refuse comme une option inconnue : acceptée, la
  // commande agirait sur des agents que l'utilisateur n'a pas nommés.
  { argv: ['install-hooks', '--user', '--target=cloude'], nomme: "'cloude'" },
  { argv: ['install-hooks', '--target=cloude'], nomme: "'cloude'" },
  { argv: ['uninstall-hooks', '--target=cloude'], nomme: "'cloude'" },
  { argv: ['install-hooks', '--user', '--target='], nomme: '--target' },
  { argv: ['uninstall-hooks', '--target=Claude'], nomme: "'Claude'" },
  { argv: ['install-hooks', '--user', '--target=all'], nomme: "'all'" },
];

for (const { argv, nomme } of REFUS) {
  test(`agent-viz ${argv.join(' ')} : refusé, sortie 2, aucun module chargé`, () => {
    // Arrange
    const racine = nouvelleRacine(PREFIXE);
    try {
      ecrireDistAvecTemoins(racine);

      // Act
      const r = lance(racine, argv);

      // Assert
      const sortie = `${r.stdout}${r.stderr}`;
      assert.equal(r.status, 2, `code de sortie attendu 2, obtenu ${r.status} :\n${sortie}`);
      assert.ok(r.stderr.includes(nomme), `le refus devrait nommer ${nomme} :\n${sortie}`);
      assert.ok(r.stderr.includes('agent-viz --help'), `le refus devrait renvoyer vers l'aide :\n${sortie}`);
      assert.deepEqual(temoinsCharges(racine), [], 'aucun module de dist/ ne doit être chargé avant le refus');
    } finally {
      nettoie(racine);
    }
  });
}

test('hook avec une option inconnue : le hook tourne et sort 0', () => {
  // Arrange
  const racine = nouvelleRacine(PREFIXE);
  try {
    ecrireDistAvecTemoins(racine, { 'server/hook.js': HOOK_SONDE });

    // Act
    const r = lance(racine, ['hook', '--bogus']);

    // Assert
    const sortie = `${r.stdout}${r.stderr}`;
    assert.equal(r.status, 0, `code de sortie attendu 0, obtenu ${r.status} :\n${sortie}`);
    assert.ok(r.stdout.includes('SONDE_HOOK_OK'), `le hook devrait tourner :\n${sortie}`);
  } finally {
    nettoie(racine);
  }
});

test('hook --source=copilot, la forme écrite par l\'installeur : le hook tourne et sort 0', () => {
  // Arrange
  const racine = nouvelleRacine(PREFIXE);
  try {
    ecrireDistAvecTemoins(racine, { 'server/hook.js': HOOK_SONDE });

    // Act
    const r = lance(racine, ['hook', '--source=copilot']);

    // Assert
    const sortie = `${r.stdout}${r.stderr}`;
    assert.equal(r.status, 0, `code de sortie attendu 0, obtenu ${r.status} :\n${sortie}`);
    assert.ok(r.stdout.includes('SONDE_HOOK_OK'), `le hook devrait tourner :\n${sortie}`);
  } finally {
    nettoie(racine);
  }
});

test('contrôle inverse : les options déclarées de start passent l\'analyse et la commande charge dist/', () => {
  // Arrange
  const racine = nouvelleRacine(PREFIXE);
  try {
    ecrireDistAvecTemoins(racine);

    // Act
    const r = lance(racine, ['start', '--port=4000', '--no-install-hooks', '--foreground']);

    // Assert
    const sortie = `${r.stdout}${r.stderr}`;
    assert.notEqual(r.status, 2, `des options déclarées ne doivent pas être refusées :\n${sortie}`);
    assert.ok(temoinsCharges(racine).includes('CHARGE-server-lifecycle.js'),
      `start aurait dû charger lifecycle.js après l'analyse :\n${sortie}`);
  } finally {
    nettoie(racine);
  }
});

test('contrôle inverse : les options déclarées d\'install-hooks passent l\'analyse et la commande charge dist/', () => {
  // Arrange
  const racine = nouvelleRacine(PREFIXE);
  try {
    ecrireDistAvecTemoins(racine);

    // Act
    const r = lance(racine, ['install-hooks', '--user', '--target=both', '--check']);

    // Assert
    const sortie = `${r.stdout}${r.stderr}`;
    assert.notEqual(r.status, 2, `des options déclarées ne doivent pas être refusées :\n${sortie}`);
    assert.ok(temoinsCharges(racine).includes('CHARGE-server-install-hooks.js'),
      `install-hooks aurait dû charger install-hooks.js après l'analyse :\n${sortie}`);
  } finally {
    nettoie(racine);
  }
});

// Le binaire porte sa propre copie des cibles valides : ce test la confronte
// au registre, qui fait foi.
test('miroir : le refus de --target cite les cibles du registre', () => {
  // Arrange
  const racine = nouvelleRacine(PREFIXE);
  try {
    ecrireDistAvecTemoins(racine);

    // Act
    const r = lance(racine, ['uninstall-hooks', '--target=cloude']);

    // Assert
    const sortie = `${r.stdout}${r.stderr}`;
    assert.equal(r.status, 2, `code de sortie attendu 2, obtenu ${r.status} :\n${sortie}`);
    const attendu = `Option '--target' must be one of ${TARGETS.join('|')}, got 'cloude'`;
    assert.ok(r.stderr.includes(attendu), `le refus devrait dire « ${attendu} » :\n${sortie}`);
  } finally {
    nettoie(racine);
  }
});

test('contrôle inverse : chaque cible du registre passe l\'analyse et uninstall-hooks charge dist/', () => {
  for (const cible of TARGETS) {
    // Arrange
    const racine = nouvelleRacine(PREFIXE);
    try {
      ecrireDistAvecTemoins(racine);

      // Act
      const r = lance(racine, ['uninstall-hooks', '--user', `--target=${cible}`]);

      // Assert
      const sortie = `${r.stdout}${r.stderr}`;
      assert.notEqual(r.status, 2, `la cible ${cible} ne doit pas être refusée :\n${sortie}`);
      assert.ok(temoinsCharges(racine).includes('CHARGE-server-install-hooks.js'),
        `uninstall-hooks --target=${cible} aurait dû charger install-hooks.js après l'analyse :\n${sortie}`);
    } finally {
      nettoie(racine);
    }
  }
});

test('contrôle inverse : la forme --target claude, séparée par une espace, passe l\'analyse', () => {
  // Arrange
  const racine = nouvelleRacine(PREFIXE);
  try {
    ecrireDistAvecTemoins(racine);

    // Act
    const r = lance(racine, ['uninstall-hooks', '--user', '--target', 'claude']);

    // Assert
    const sortie = `${r.stdout}${r.stderr}`;
    assert.notEqual(r.status, 2, `la forme avec espace ne doit pas être refusée :\n${sortie}`);
    assert.ok(temoinsCharges(racine).includes('CHARGE-server-install-hooks.js'),
      `uninstall-hooks --target claude aurait dû charger install-hooks.js après l'analyse :\n${sortie}`);
  } finally {
    nettoie(racine);
  }
});

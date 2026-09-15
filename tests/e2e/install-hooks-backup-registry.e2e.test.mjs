// Chaque mutation d'un fichier de hooks passe d'abord par sa copie, vérifiée à
// travers le vrai registre sur un projet jetable. Chaque test pose son propre
// home : la racine des copies se recalcule depuis lui à chaque appel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { INSTALLERS, install, uninstall } from '../../src/server/install-hooks/registry.ts';

const INSTALL_HOOKS = fileURLToPath(new URL('../../src/server/install-hooks.ts', import.meta.url));
const NOTRE_COMMANDE = 'node "/ailleurs/agent-viz/bin/agent-viz.js" hook';
const NOTRE_ENTREE_COPILOT = { type: 'command', bash: NOTRE_COMMANDE, powershell: NOTRE_COMMANDE, timeoutSec: 10 };
const ENTREE_TIERCE = { type: 'command', bash: 'echo hook-d-un-tiers' };
const json = valeur => JSON.stringify(valeur, null, 2) + '\n';
const SETTINGS_AVEC_NOTRE_HOOK = json({ model: 'x', hooks: { Stop: [{ hooks: [{ type: 'command', command: NOTRE_COMMANDE }] }] } });

const fichierClaude = projet => path.join(projet, '.claude', 'settings.json');
const fichierCopilot = projet => path.join(projet, '.github', 'hooks', 'agent-viz.json');

// Les mutations de chaque agent du registre ; un agent ajouté sans ses lignes
// fait rougir le test de couverture plus bas.
const MUTATIONS = {
  claude: [
    { nom: 'l\'installation Claude', fichier: fichierClaude, avant: '{"model":"x"}',
      agir: install, copieRendue: r => r.claude.backup, fichierReste: true },
    { nom: 'le retrait Claude', fichier: fichierClaude, avant: SETTINGS_AVEC_NOTRE_HOOK,
      agir: uninstall, copieRendue: r => r.claude.results[0].backup, fichierReste: true },
  ],
  copilot: [
    { nom: 'l\'installation Copilot', fichier: fichierCopilot, avant: json({ version: 1, hooks: { PreToolUse: [ENTREE_TIERCE] } }),
      agir: install, copieRendue: r => r.copilot.backup, fichierReste: true },
    { nom: 'le retrait partiel Copilot', fichier: fichierCopilot,
      avant: json({ version: 1, hooks: { PreToolUse: [NOTRE_ENTREE_COPILOT, ENTREE_TIERCE] } }),
      agir: uninstall, copieRendue: r => r.copilot.results[0].backup, fichierReste: true },
    { nom: 'la suppression du fichier Copilot', fichier: fichierCopilot, avant: json({ version: 1, hooks: { PreToolUse: [NOTRE_ENTREE_COPILOT] } }),
      agir: uninstall, copieRendue: r => r.copilot.results[0].backup, fichierReste: false },
  ],
};

// Détourne USERPROFILE et HOME vers un home neuf ; `rendre` remet l'environnement d'avant.
function poserHome() {
  const avant = { USERPROFILE: process.env.USERPROFILE, HOME: process.env.HOME };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'avtest-backup-home-'));
  Object.assign(process.env, { USERPROFILE: dir, HOME: dir });
  const rendre = () => {
    for (const [cle, valeur] of Object.entries(avant)) {
      if (valeur === undefined) delete process.env[cle];
      else process.env[cle] = valeur;
    }
  };
  return { dir, racineCopies: path.join(os.homedir(), '.agent-viz', 'backups'), rendre };
}

// `resolveScope({ scope: 'project' })` exige un `.git` pour trouver la racine ;
// un paquet vide fait écrire la commande npx, sans rien lire du dépôt.
function projetJetable() {
  const projet = fs.mkdtempSync(path.join(os.tmpdir(), 'avtest-backup-projet-'));
  fs.mkdirSync(path.join(projet, '.git'));
  const packageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'avtest-pkg-'));
  return { projet, packageRoot };
}

function ecrire(fichier, contenu) {
  fs.mkdirSync(path.dirname(fichier), { recursive: true });
  fs.writeFileSync(fichier, contenu);
}

for (const [agent, lignes] of Object.entries(MUTATIONS)) {
  for (const m of lignes) {
    test(`${m.nom} dépose une copie des octets d'avant et rend son chemin`, () => {
      // Arrange
      const home = poserHome();
      try {
        const { projet, packageRoot } = projetJetable();
        const fichier = m.fichier(projet);
        ecrire(fichier, m.avant);
        // Act
        const resultat = m.agir({ target: agent, scope: 'project', cwd: projet, packageRoot });
        // Assert
        const copie = m.copieRendue(resultat);
        assert.equal(typeof copie, 'string', JSON.stringify(resultat));
        assert.ok(copie.startsWith(home.racineCopies + path.sep), `copie hors de la racine attendue : ${copie}`);
        assert.equal(fs.readFileSync(copie, 'utf8'), m.avant);
        assert.equal(fs.existsSync(fichier), m.fichierReste);
      } finally {
        home.rendre();
      }
    });

    test(`si la copie échoue, ${m.nom} laisse le fichier intact`, () => {
      // Arrange
      const home = poserHome();
      try {
        const { projet, packageRoot } = projetJetable();
        const fichier = m.fichier(projet);
        ecrire(fichier, m.avant);
        // Un fichier ordinaire à la place de la racine : aucun dossier de copies ne peut s'y créer.
        ecrire(home.racineCopies, 'pas un dossier');
        // Act
        const resultat = m.agir({ target: agent, scope: 'project', cwd: projet, packageRoot });
        // Assert
        assert.match(resultat[agent].error ?? '', /^backup of .+ failed, file left unchanged: /, JSON.stringify(resultat));
        assert.equal(fs.readFileSync(fichier, 'utf8'), m.avant);
      } finally {
        home.rendre();
      }
    });
  }
}

test('une installation sur des fichiers absents ne rend aucune copie et ne crée pas la racine des copies', () => {
  // Arrange
  const home = poserHome();
  try {
    const { projet, packageRoot } = projetJetable();
    // Act
    const resultat = install({ target: 'both', scope: 'project', cwd: projet, packageRoot });
    // Assert
    assert.deepEqual([resultat.claude.backup, resultat.copilot.backup], [null, null], JSON.stringify(resultat));
    assert.equal(fs.existsSync(home.racineCopies), false);
  } finally {
    home.rendre();
  }
});

test('une installation déjà à jour ne rend aucune copie', () => {
  // Arrange
  const home = poserHome();
  try {
    const { projet, packageRoot } = projetJetable();
    install({ target: 'both', scope: 'project', cwd: projet, packageRoot });
    // Act
    const resultat = install({ target: 'both', scope: 'project', cwd: projet, packageRoot });
    // Assert
    assert.deepEqual([resultat.claude.action, resultat.copilot.action], ['noop', 'noop']);
    assert.deepEqual([resultat.claude.backup, resultat.copilot.backup], [null, null]);
  } finally {
    home.rendre();
  }
});

test('chaque agent du registre a ses lignes dans la table des mutations', () => {
  // Arrange — le registre importé ci-dessus
  // Act
  const agents = Object.keys(INSTALLERS).sort();
  // Assert
  assert.deepEqual(agents, Object.keys(MUTATIONS).sort());
});

// Le module lancé comme script dans un processus fils, avec un PATH vide et un
// home jetable : aucun agent n'est détecté et le registre retombe sur Claude.
function lanceCli(args, projet) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'avtest-backup-cli-home-'));
  const sansPath = Object.fromEntries(Object.entries(process.env).filter(([cle]) => cle.toUpperCase() !== 'PATH'));
  return spawnSync(process.execPath, [INSTALL_HOOKS, ...args], {
    cwd: projet,
    encoding: 'utf8',
    env: { ...sansPath, PATH: '', USERPROFILE: home, HOME: home, AGENT_VIZ_PORT: '59999' },
  });
}

function ligneApres(sortie, debut) {
  const lignes = sortie.split(/\r?\n/);
  const i = lignes.findIndex(ligne => ligne.startsWith(debut));
  return i === -1 ? null : (lignes[i + 1] ?? null);
}

test('la CLI directe, sur un settings.json qui existe, imprime la ligne backup sous la commande du hook', () => {
  // Arrange
  const { projet } = projetJetable();
  ecrire(fichierClaude(projet), '{}');
  // Act
  const r = lanceCli(['--project'], projet);
  // Assert
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  assert.match(ligneApres(r.stdout, '[claude] hook cmd : ') ?? '', /^\[claude\] backup {3}: \S/, r.stdout);
});

test('la CLI directe, sans fichier de hooks, n\'imprime aucune ligne backup', () => {
  // Arrange
  const { projet } = projetJetable();
  // Act
  const r = lanceCli(['--project'], projet);
  // Assert
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  assert.ok(r.stdout.includes('[claude] hook cmd : '), `l'installation devait s'afficher :\n${r.stdout}`);
  assert.doesNotMatch(r.stdout, /^\[claude\] +backup/m);
});

test('la CLI directe, au retrait, imprime la ligne backup sous la ligne du fichier retiré', () => {
  // Arrange
  const { projet } = projetJetable();
  ecrire(fichierClaude(projet), SETTINGS_AVEC_NOTRE_HOOK);
  // Act
  const r = lanceCli(['--project', '--uninstall'], projet);
  // Assert
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  assert.match(ligneApres(r.stdout, '[claude] ✓ retiré ') ?? '', /^\[claude\] {3}backup: \S/, r.stdout);
});

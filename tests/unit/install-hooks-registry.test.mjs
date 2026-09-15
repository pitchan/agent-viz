// Le contrat qui rend l'ajout d'un 3e agent falsifiable : chaque entrée du
// registre expose les 6 méthodes d'AgentInstaller. Sans sweepTargets et
// installedIn, findInstalledScopes rebrancherait sur le nom d'agent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { INSTALLERS, TARGETS, install, pickAgents, uninstall } from '../../src/server/install-hooks/registry.ts';

// Un bac à sable qui ressemble à un projet : `resolveScope({ scope: 'project' })`
// exige un `.git` pour trouver la racine. La portée `user`, elle, vise le bac de
// `test-support/env-guard.mjs`, commun à tous les tests de ce fichier.
function sandboxProject(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(root, '.git'));
  return root;
}

const METHODS = ['install', 'uninstall', 'audit', 'detect', 'sweepTargets', 'installedIn'];

test('chaque adaptateur du registre expose le contrat AgentInstaller complet', () => {
  // Arrange — le registre importé ci-dessus
  // Act
  const agents = Object.keys(INSTALLERS).sort();
  // Assert
  assert.deepEqual(agents, ['claude', 'copilot']);
  for (const [name, inst] of Object.entries(INSTALLERS)) {
    for (const m of METHODS) {
      assert.equal(typeof inst[m], 'function', `${name}.${m} doit être une fonction`);
    }
  }
});

test('le refus d\'un adaptateur ne traverse pas le registre et ne jette pas le résultat des autres', () => {
  // Arrange — un fichier Copilot qui existe, JSON valide, mais qui n'est pas à nous
  const root = sandboxProject('avtest-liskov-hostile-');
  const packageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'avtest-pkg-'));
  const copilotFile = path.join(root, '.github', 'hooks', 'agent-viz.json');
  fs.mkdirSync(path.dirname(copilotFile), { recursive: true });
  fs.writeFileSync(copilotFile, JSON.stringify({ version: 99, note: 'pas à nous' }, null, 2));

  // Act — les DEUX agents, Claude passe en premier dans le registre
  const result = install({ target: 'both', scope: 'project', cwd: root, packageRoot });

  // Assert — la case fautive porte une valeur, pas une exception
  assert.equal(typeof result.copilot.error, 'string', 'copilot doit rendre { error }');
  assert.match(result.copilot.error, /refusing to overwrite/);
  // …et le travail de l'agent sain n'est pas jeté avec l'exception
  assert.equal(result.claude.action, 'installed');
  assert.ok(
    fs.existsSync(path.join(root, '.claude', 'settings.json')),
    'l\'install claude doit avoir eu lieu et être visible sur le disque',
  );
});

test('l\'install préserve les entrées tierces du fichier — la postcondition « untouched » est vraie', () => {
  // Arrange — NOTRE fichier (version 1 + une commande agent-viz), plus un hook tiers
  const root = sandboxProject('avtest-liskov-tiers-');
  const packageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'avtest-pkg-'));
  const file = path.join(root, '.github', 'hooks', 'agent-viz.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const notre = 'node /ailleurs/agent-viz/hook.js --source=copilot';
  fs.writeFileSync(file, JSON.stringify({
    version: 1,
    hooks: {
      PreToolUse: [
        { type: 'command', bash: notre, powershell: notre, timeoutSec: 10 },
        { type: 'command', bash: 'echo hook-d-un-tiers' },
      ],
    },
  }, null, 2));

  // Act
  const result = install({ target: 'copilot', scope: 'project', cwd: root, packageRoot });

  // Assert — on relit le DISQUE, on ne croit pas la valeur de retour
  const apres = JSON.parse(fs.readFileSync(file, 'utf8'));
  const commandes = apres.hooks.PreToolUse.map(e => e.bash);
  assert.ok(
    commandes.includes('echo hook-d-un-tiers'),
    `entrée tierce détruite par l'install : ${JSON.stringify(commandes)}`,
  );
  // …et notre hook a bien été rafraîchi au passage : la commande exacte
  // annoncée par le résultat a atteint le disque, l'ancienne a disparu — ni
  // l'une ni l'autre n'était vraie tant que `mergeCopilotHooks` préservait
  // l'entrée périmée au lieu de la remplacer.
  assert.equal(result.copilot.coexisting.PreToolUse, 1);
  assert.ok(commandes.includes(result.copilot.command.command));
  assert.ok(!commandes.includes(notre));
});

test('uninstall rend le nombre réel de retraits, jamais un forfait', () => {
  // Arrange — notre fichier, mais notre hook sur 2 événements SEULEMENT (sur 5)
  const root = sandboxProject('avtest-liskov-removed-');
  const packageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'avtest-pkg-'));
  const file = path.join(root, '.github', 'hooks', 'agent-viz.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const notre = 'node /ailleurs/agent-viz/hook.js --source=copilot';
  const entree = { type: 'command', bash: notre, powershell: notre, timeoutSec: 10 };
  fs.writeFileSync(file, JSON.stringify({
    version: 1,
    hooks: { PreToolUse: [entree], Stop: [entree] },
  }, null, 2));

  // Act — PORTÉE EXPLICITE : sans portée, uninstall balaye depuis le cwd
  const result = uninstall({ target: 'copilot', scope: 'project', cwd: root, packageRoot });

  // Assert
  const total = result.copilot.results.reduce((n, r) => n + r.removed, 0);
  assert.equal(total, 2, `attendu 2 retraits réels, reçu ${total} (forfait ?)`);
});

test('uninstall ne supprime pas le fichier qui porte encore des entrées tierces', () => {
  // Arrange — notre hook sur 1 événement, plus un hook tiers sur le même
  const root = sandboxProject('avtest-liskov-uninst-tiers-');
  const packageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'avtest-pkg-'));
  const file = path.join(root, '.github', 'hooks', 'agent-viz.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const notre = 'node /ailleurs/agent-viz/hook.js --source=copilot';
  fs.writeFileSync(file, JSON.stringify({
    version: 1,
    hooks: {
      PreToolUse: [
        { type: 'command', bash: notre, powershell: notre, timeoutSec: 10 },
        { type: 'command', bash: 'echo hook-d-un-tiers' },
      ],
    },
  }, null, 2));

  // Act
  const result = uninstall({ target: 'copilot', scope: 'project', cwd: root, packageRoot });

  // Assert — le fichier survit, l'entrée tierce aussi, et removed vaut 1
  assert.ok(fs.existsSync(file), 'le fichier portant une entrée tierce ne doit pas être supprimé');
  const apres = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(apres.hooks.PreToolUse.map(e => e.bash), ['echo hook-d-un-tiers']);
  const total = result.copilot.results.reduce((n, r) => n + r.removed, 0);
  assert.equal(total, 1);
});

test('aller-retour install → uninstall → install : le cycle stop/start reste réinstallable', () => {
  // Arrange — NOTRE entrée plus une entrée tierce, exactement l'état qu'un
  // utilisateur a sur le disque avant un `agent-viz stop` suivi d'un `start`.
  // Chaque test précédent ne regardait QU'UNE opération isolée : c'est ce qui a
  // laissé passer un refus définitif au 2e install (cf. D2 bis de la spec).
  const root = sandboxProject('avtest-liskov-allerretour-');
  const packageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'avtest-pkg-'));
  const file = path.join(root, '.github', 'hooks', 'agent-viz.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const notre = 'node /ailleurs/agent-viz/hook.js --source=copilot';
  const tiers = 'echo hook-d-un-tiers';
  fs.writeFileSync(file, JSON.stringify({
    version: 1,
    hooks: {
      PreToolUse: [
        { type: 'command', bash: notre, powershell: notre, timeoutSec: 10 },
        { type: 'command', bash: tiers },
      ],
    },
  }, null, 2));
  const surLeDisque = () => JSON.parse(fs.readFileSync(file, 'utf8'));
  const toutesCommandes = () => Object.values(surLeDisque().hooks)
    .flat()
    .map(e => e.bash);

  // Act 1 — install
  const install1 = install({ target: 'copilot', scope: 'project', cwd: root, packageRoot });
  // Assert 1 — l'entrée tierce survit
  assert.equal(install1.copilot.error, undefined, `install #1 refusé : ${install1.copilot.error}`);
  assert.ok(toutesCommandes().includes(tiers), 'entrée tierce perdue à l\'install #1');

  // Act 2 — uninstall (PORTÉE EXPLICITE : sans portée, le balayage part du cwd)
  const desinstall = uninstall({ target: 'copilot', scope: 'project', cwd: root, packageRoot });
  // Assert 2 — le fichier est conservé pour l'entrée tierce, qui survit
  assert.equal(desinstall.copilot.error, undefined, `uninstall refusé : ${desinstall.copilot.error}`);
  assert.ok(fs.existsSync(file), 'le fichier portant une entrée tierce ne doit pas être supprimé');
  assert.ok(toutesCommandes().includes(tiers), 'entrée tierce perdue à l\'uninstall');

  // Act 3 — install de nouveau, sur le fichier qui ne porte PLUS aucune de nos
  // entrées : c'est ici que le refus se déclenchait, définitivement.
  const install2 = install({ target: 'copilot', scope: 'project', cwd: root, packageRoot });

  // Assert 3 — aucun refus, l'entrée tierce est toujours là, la nôtre est revenue
  assert.equal(
    install2.copilot.error, undefined,
    `install #2 refusé — l'aller-retour n'est pas réinstallable : ${install2.copilot.error}`,
  );
  const finales = toutesCommandes();
  assert.ok(finales.includes(tiers), `entrée tierce perdue à l'install #2 : ${JSON.stringify(finales)}`);
  assert.ok(
    finales.includes(install2.copilot.command.command),
    `notre entrée absente du disque après l'install #2 : ${JSON.stringify(finales)}`,
  );
});

test('un 3e agent hypothétique serait affiché : le rendu ne nomme aucun agent en dur', () => {
  // Arrange — le registre réel, plus une entrée synthétique qui n'existe pas
  // dans AGENT_CONFIG : on ne teste que la FORME du rendu, pas l'installation.
  const noms = Object.keys(INSTALLERS);

  // Act
  const source = fs.readFileSync(
    new URL('../../src/server/install-hooks/cli.ts', import.meta.url), 'utf8',
  );

  // Assert — plus aucun accès en dur `result.claude` / `result.copilot`
  for (const nom of noms) {
    assert.ok(
      !source.includes(`result.${nom}`),
      `cli.ts nomme encore result.${nom} en dur — un 3e agent ne serait pas affiché`,
    );
  }
});

test('TARGETS liste les agents du registre puis both, dans cet ordre', () => {
  // Arrange — le registre importé ci-dessus
  // Act
  const cibles = TARGETS;
  // Assert
  assert.deepEqual(cibles, ['claude', 'copilot', 'both']);
});

// Une cible inconnue lève au lieu de retomber sur l'auto-détection : sinon une
// faute de frappe agit sur les agents détectés, que personne n'a nommés.
for (const cible of ['cloude', 'all', '']) {
  test(`pickAgents lève sur la cible inconnue '${cible}'`, () => {
    // Arrange — la cible seule, aucun fichier
    // Act
    const appel = () => pickAgents({ target: cible });
    // Assert
    assert.throws(appel, new RegExp(`unknown target '${cible}'`));
  });
}

test('install avec une cible inconnue lève et n\'écrit aucun fichier de hooks', () => {
  // Arrange
  const root = sandboxProject('avtest-cible-inconnue-install-');
  const packageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'avtest-pkg-'));

  // Act
  const appel = () => install({ target: 'cloude', scope: 'project', cwd: root, packageRoot });

  // Assert
  assert.throws(appel, /unknown target 'cloude'/);
  assert.ok(!fs.existsSync(path.join(root, '.claude', 'settings.json')), 'aucun fichier Claude ne doit être écrit');
  assert.ok(!fs.existsSync(path.join(root, '.github', 'hooks', 'agent-viz.json')), 'aucun fichier Copilot ne doit être écrit');
});

test('uninstall avec une cible inconnue lève et laisse en place le hook posé', () => {
  // Arrange — un hook Claude posé dans le projet
  const root = sandboxProject('avtest-cible-inconnue-uninstall-');
  const packageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'avtest-pkg-'));
  const settings = path.join(root, '.claude', 'settings.json');
  install({ target: 'claude', scope: 'project', cwd: root, packageRoot });
  assert.ok(INSTALLERS.claude.installedIn(settings), 'le hook Claude doit être posé avant l\'essai');

  // Act
  const appel = () => uninstall({ target: 'cloude', scope: 'project', cwd: root, packageRoot });

  // Assert
  assert.throws(appel, /unknown target 'cloude'/);
  assert.ok(INSTALLERS.claude.installedIn(settings), 'le hook Claude doit rester posé après le refus');
});

// Le contrat qui rend l'ajout d'un 3e agent falsifiable : chaque entrée du
// registre expose les 6 méthodes d'AgentInstaller. Sans sweepTargets et
// installedIn, findInstalledScopes rebrancherait sur le nom d'agent.
import { expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { INSTALLERS, TARGETS, install, pickAgents, uninstall } from '../../src/server/install-hooks/registry.ts';
import type { AgentInstaller, Target } from '../../src/server/install-hooks/types.ts';

// Un bac à sable qui ressemble à un projet : `resolveScope({ scope: 'project' })`
// exige un `.git` pour trouver la racine. La portée `user`, elle, vise le bac de
// `test-support/env-guard.ts`, commun à tous les tests de ce fichier.
function sandboxProject(prefix: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(root, '.git'));
  return root;
}

const METHODS: (keyof AgentInstaller)[] = ['install', 'uninstall', 'audit', 'detect', 'sweepTargets', 'installedIn'];

// `install`/`uninstall` du registre rendent `Record<string, unknown>` — chaque
// adaptateur est libre de sa forme (voir AgentInstaller dans types.ts). Cette
// interface locale ne couvre que les champs que CE fichier lit réellement.
interface AgentResult {
  error?: string;
  action?: string;
  coexisting?: Record<string, number>;
  command?: { command: string };
  results?: Array<{ removed: number }>;
}

test('chaque adaptateur du registre expose le contrat AgentInstaller complet', () => {
  // Arrange — le registre importé ci-dessus
  // Act
  const agents = Object.keys(INSTALLERS).sort();
  // Assert
  expect(agents).toEqual(['claude', 'copilot']);
  for (const [name, inst] of Object.entries(INSTALLERS)) {
    for (const m of METHODS) {
      expect(typeof inst[m], `${name}.${m} doit être une fonction`).toBe('function');
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
  const copilot = result.copilot as AgentResult;
  const claude = result.claude as AgentResult;

  // Assert — la case fautive porte une valeur, pas une exception
  expect(typeof copilot.error, 'copilot doit rendre { error }').toBe('string');
  expect(copilot.error).toMatch(/refusing to overwrite/);
  // …et le travail de l'agent sain n'est pas jeté avec l'exception
  expect(claude.action).toBe('installed');
  expect(fs.existsSync(path.join(root, '.claude', 'settings.json')), 'l\'install claude doit avoir eu lieu et être visible sur le disque').toBeTruthy();
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
  const copilot = result.copilot as AgentResult;

  // Assert — on relit le DISQUE, on ne croit pas la valeur de retour
  const apres = JSON.parse(fs.readFileSync(file, 'utf8'));
  const commandes = apres.hooks.PreToolUse.map((e: any) => e.bash);
  expect(commandes.includes('echo hook-d-un-tiers'), `entrée tierce détruite par l'install : ${JSON.stringify(commandes)}`).toBeTruthy();
  // …et notre hook a bien été rafraîchi au passage : la commande annoncée a atteint
  // le disque et l'ancienne a disparu, deux faits faux quand `mergeCopilotHooks`
  // préservait l'entrée périmée au lieu de la remplacer.
  expect(copilot.coexisting?.PreToolUse).toBe(1);
  expect(commandes.includes(copilot.command?.command)).toBeTruthy();
  expect(!commandes.includes(notre)).toBeTruthy();
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
  const copilot = result.copilot as AgentResult;

  // Assert
  const total = (copilot.results ?? []).reduce((n, r) => n + r.removed, 0);
  expect(total, `attendu 2 retraits réels, reçu ${total} (forfait ?)`).toBe(2);
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
  const copilot = result.copilot as AgentResult;

  // Assert — le fichier survit, l'entrée tierce aussi, et removed vaut 1
  expect(fs.existsSync(file), 'le fichier portant une entrée tierce ne doit pas être supprimé').toBeTruthy();
  const apres = JSON.parse(fs.readFileSync(file, 'utf8'));
  expect(apres.hooks.PreToolUse.map((e: any) => e.bash)).toEqual(['echo hook-d-un-tiers']);
  const total = (copilot.results ?? []).reduce((n, r) => n + r.removed, 0);
  expect(total).toBe(1);
});

test('aller-retour install → uninstall → install : le cycle stop/start reste réinstallable', () => {
  // Arrange — NOTRE entrée plus une entrée tierce, exactement l'état qu'un
  // utilisateur a sur le disque avant un `agent-viz stop` suivi d'un `start`. Des tests
  // d'une opération isolée laissaient passer un refus définitif au 2e install.
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
  const toutesCommandes = (): string[] => Object.values(surLeDisque().hooks)
    .flat()
    .map((e: any) => e.bash);

  // Act 1 — install
  const install1 = install({ target: 'copilot', scope: 'project', cwd: root, packageRoot });
  const copilot1 = install1.copilot as AgentResult;
  // Assert 1 — l'entrée tierce survit
  expect(copilot1.error, `install #1 refusé : ${copilot1.error}`).toBe(undefined);
  expect(toutesCommandes().includes(tiers), 'entrée tierce perdue à l\'install #1').toBeTruthy();

  // Act 2 — uninstall (PORTÉE EXPLICITE : sans portée, le balayage part du cwd)
  const desinstall = uninstall({ target: 'copilot', scope: 'project', cwd: root, packageRoot });
  const copilotDesinstall = desinstall.copilot as AgentResult;
  // Assert 2 — le fichier est conservé pour l'entrée tierce, qui survit
  expect(copilotDesinstall.error, `uninstall refusé : ${copilotDesinstall.error}`).toBe(undefined);
  expect(fs.existsSync(file), 'le fichier portant une entrée tierce ne doit pas être supprimé').toBeTruthy();
  expect(toutesCommandes().includes(tiers), 'entrée tierce perdue à l\'uninstall').toBeTruthy();

  // Act 3 — install de nouveau, sur le fichier qui ne porte PLUS aucune de nos
  // entrées : c'est ici que le refus se déclenchait, définitivement.
  const install2 = install({ target: 'copilot', scope: 'project', cwd: root, packageRoot });
  const copilot2 = install2.copilot as AgentResult;

  // Assert 3 — aucun refus, l'entrée tierce est toujours là, la nôtre est revenue
  expect(copilot2.error, `install #2 refusé — l'aller-retour n'est pas réinstallable : ${copilot2.error}`).toBe(undefined);
  const finales = toutesCommandes();
  expect(finales.includes(tiers), `entrée tierce perdue à l'install #2 : ${JSON.stringify(finales)}`).toBeTruthy();
  expect(finales.includes(copilot2.command?.command ?? ''), `notre entrée absente du disque après l'install #2 : ${JSON.stringify(finales)}`).toBeTruthy();
});

test('un 3e agent hypothétique serait affiché : le rendu ne nomme aucun agent en dur', () => {
  // Arrange — le registre réel, plus une entrée synthétique qui n'existe pas
  // dans AGENT_CONFIG : on ne teste que la FORME du rendu, pas l'installation.
  const noms = Object.keys(INSTALLERS);

  // Act
  const source = fs.readFileSync(
    new URL('../../src/server/install-hooks/cli.ts', import.meta.url), 'utf8',
  );

  // Assert — aucun accès en dur `result.claude` / `result.copilot`
  for (const nom of noms) {
    expect(!source.includes(`result.${nom}`), `cli.ts nomme encore result.${nom} en dur — un 3e agent ne serait pas affiché`).toBeTruthy();
  }
});

test('TARGETS liste les agents du registre puis both, dans cet ordre', () => {
  // Arrange — le registre importé ci-dessus
  // Act
  const cibles = TARGETS;
  // Assert
  expect(cibles).toEqual(['claude', 'copilot', 'both']);
});

// Une cible inconnue lève au lieu de retomber sur l'auto-détection : sinon une
// faute de frappe agit sur les agents détectés, que personne n'a nommés.
for (const cible of ['cloude', 'all', '']) {
  test(`pickAgents lève sur la cible inconnue '${cible}'`, () => {
    // Arrange — la cible seule, aucun fichier
    // Act
    const appel = () => pickAgents({ target: cible as Target });
    // Assert
    expect(appel).toThrow(new RegExp(`unknown target '${cible}'`));
  });
}

test('install avec une cible inconnue lève et n\'écrit aucun fichier de hooks', () => {
  // Arrange
  const root = sandboxProject('avtest-cible-inconnue-install-');
  const packageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'avtest-pkg-'));

  // Act
  const appel = () => install({ target: 'cloude' as Target, scope: 'project', cwd: root, packageRoot });

  // Assert
  expect(appel).toThrow(/unknown target 'cloude'/);
  expect(!fs.existsSync(path.join(root, '.claude', 'settings.json')), 'aucun fichier Claude ne doit être écrit').toBeTruthy();
  expect(!fs.existsSync(path.join(root, '.github', 'hooks', 'agent-viz.json')), 'aucun fichier Copilot ne doit être écrit').toBeTruthy();
});

test('uninstall avec une cible inconnue lève et laisse en place le hook posé', () => {
  // Arrange — un hook Claude posé dans le projet
  const root = sandboxProject('avtest-cible-inconnue-uninstall-');
  const packageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'avtest-pkg-'));
  const settings = path.join(root, '.claude', 'settings.json');
  install({ target: 'claude', scope: 'project', cwd: root, packageRoot });
  expect(INSTALLERS.claude.installedIn(settings), 'le hook Claude doit être posé avant l\'essai').toBeTruthy();

  // Act
  const appel = () => uninstall({ target: 'cloude' as Target, scope: 'project', cwd: root, packageRoot });

  // Assert
  expect(appel).toThrow(/unknown target 'cloude'/);
  expect(INSTALLERS.claude.installedIn(settings), 'le hook Claude doit rester posé après le refus').toBeTruthy();
});

import { expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findProjectRoot, findInstalledScopes, install, resolveScope, EVENTS, _internals } from '../../src/server/install-hooks.ts';
import pkg from '../../package.json' with { type: 'json' };

// `install()` rend `Record<string, unknown>` (chaque adaptateur du registre est
// libre de sa forme) — cette interface locale ne couvre que les champs que CE
// fichier lit réellement.
interface AgentInstallResult {
  action?: string;
  updated?: string[];
  missing?: string[];
  crossScope?: Array<{ scope: string }>;
  target?: { file: string };
}

function makeTempDir(prefix: string) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('findProjectRoot: home dir with .git is NOT recognized as a project', () => {
  const fakeHome = makeTempDir('avtest-home-');
  fs.mkdirSync(path.join(fakeHome, '.git'));
  const result = findProjectRoot(fakeHome, { homedir: fakeHome });
  expect(result, 'home dir must not be returned as projectRoot').toBe(null);
});

test('findProjectRoot: packageRoot with .git is NOT recognized as a project', () => {
  const pkgRoot = makeTempDir('avtest-pkg-');
  fs.mkdirSync(path.join(pkgRoot, '.git'));
  const elsewhereHome = makeTempDir('avtest-otherhome-');
  const result = findProjectRoot(pkgRoot, { packageRoot: pkgRoot, homedir: elsewhereHome });
  expect(result, 'packageRoot must not be returned as projectRoot').toBe(null);
});

test('findProjectRoot: nested cwd inside a real project still finds the project root', () => {
  const projectRoot = makeTempDir('avtest-proj-');
  fs.mkdirSync(path.join(projectRoot, '.git'));
  const child = path.join(projectRoot, 'src');
  fs.mkdirSync(child);
  const elsewhereHome = makeTempDir('avtest-otherhome2-');
  const result = findProjectRoot(child, { homedir: elsewhereHome });
  expect(result).toBe(projectRoot);
});

// Helpers for the cross-scope tests below. os.homedir() is the disposable dir that
// test-support/env-guard.mjs creates for each test file, so the user scope holds no
// hook; these tests assert the scopes they populate themselves.
function writeClaudeSettingsWithHook(file: string, command = 'node /tmp/agent-viz/lib/hook.js --source=claude') {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({
    hooks: {
      UserPromptSubmit: [{ hooks: [{ type: 'command', command, timeout: 5 }] }],
    },
  }));
}

test('findInstalledScopes: detects agent-viz hooks pre-installed in project + local', () => {
  const projectRoot = makeTempDir('avtest-cross-');
  fs.mkdirSync(path.join(projectRoot, '.git'));
  writeClaudeSettingsWithHook(path.join(projectRoot, '.claude', 'settings.json'));
  writeClaudeSettingsWithHook(path.join(projectRoot, '.claude', 'settings.local.json'));
  const found = findInstalledScopes({ cwd: projectRoot, packageRoot: makeTempDir('avtest-pkg-'), agent: 'claude' });
  const scopes = found.installed.map(f => f.scope);
  expect(scopes.includes('project'), `expected 'project' in ${scopes.join(',')}`).toBeTruthy();
  expect(scopes.includes('local'), `expected 'local' in ${scopes.join(',')}`).toBeTruthy();
});

test('install: refreshes existing hook whose timeout drifted (5 → 10)', () => {
  const projectRoot = makeTempDir('avtest-timeout-');
  fs.mkdirSync(path.join(projectRoot, '.git'));
  // Pre-existing hook with the exact desired command BUT obsolete timeout=5.
  // Without the upgrade path, this would noop and the timeout would stay 5.
  // Le spec npx épingle la version du produit, jamais celle d'un package.json voisin.
  const versionDuProduit = pkg.version;
  const command = `npx --yes @vcueto/agent-viz@${versionDuProduit} hook --source=claude`;
  const settingsFile = path.join(projectRoot, '.claude', 'settings.json');
  fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
  fs.writeFileSync(settingsFile, JSON.stringify({
    hooks: Object.fromEntries(
      ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'SessionStart']
        .map(ev => [ev, [{ hooks: [{ type: 'command', command, timeout: 5 }] }]]),
    ),
  }));

  const result = install({
    target: 'claude',
    scope: 'project',
    cwd: projectRoot,
    packageRoot: makeTempDir('avtest-pkg-timeout-'),
  });
  const r = result.claude as AgentInstallResult;
  // Une config d'avant PostToolUseFailure : les 5 anciens sont rafraîchis ET le
  // 6e est posé au passage — d'où 'installed+updated' et non 'updated'.
  expect(r.action, `expected action='installed+updated', got '${r.action}'`).toBe('installed+updated');
  expect(r.updated?.length, `expected all 5 events refreshed, got ${r.updated?.length}`).toBe(5);
  expect(r.missing, 'seul le nouvel evenement doit manquer').toEqual(['PostToolUseFailure']);

  const persisted = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  for (const ev of ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'SessionStart']) {
    const h = persisted.hooks[ev][0].hooks[0];
    expect(h.timeout, `${ev} timeout should be upgraded to 10, got ${h.timeout}`).toBe(10);
    expect(h.command, `${ev} command should be preserved`).toBe(command);
  }
  // Le 6e echappe a la boucle ci-dessus (elle compare a l'ANCIENNE commande) :
  // il faut sa propre assertion, sinon rien ne prouve qu'il a atteint le disque.
  const ajoute = persisted.hooks.PostToolUseFailure[0].hooks[0];
  expect(ajoute.timeout, `PostToolUseFailure timeout should be 10, got ${ajoute.timeout}`).toBe(10);
});

test('resolveScope: no explicit scope defaults to user (global) even inside a project', () => {
  const projectRoot = makeTempDir('avtest-defscope-');
  fs.mkdirSync(path.join(projectRoot, '.git'));
  for (const agent of ['claude', 'copilot'] as const) {
    const r = resolveScope({ cwd: projectRoot, agent });
    expect(r.scope, `${agent}: default scope should be 'user', got '${r.scope}'`).toBe('user');
    expect(r.projectRoot, `${agent}: user scope must not carry a projectRoot`).toBe(null);
  }
});

test('resolveScope: explicit --local still resolves to the per-repo file', () => {
  const projectRoot = makeTempDir('avtest-localscope-');
  fs.mkdirSync(path.join(projectRoot, '.git'));
  const r = resolveScope({ scope: 'local', cwd: projectRoot, agent: 'claude' });
  expect(r.scope).toBe('local');
  expect(r.projectRoot).toBe(projectRoot);
});

test('resolveScope: explicit --local with no project still throws', () => {
  const lonelyHome = makeTempDir('avtest-noproj-');
  expect(
    () => resolveScope({ scope: 'local', cwd: lonelyHome, agent: 'claude', packageRoot: lonelyHome }),
  ).toThrow(/--local requested but no/);
});

test('install: crossScope flags pre-existing hook in a different scope', () => {
  const projectRoot = makeTempDir('avtest-install-');
  fs.mkdirSync(path.join(projectRoot, '.git'));
  // Pre-existing hook in local scope.
  writeClaudeSettingsWithHook(path.join(projectRoot, '.claude', 'settings.local.json'));
  // Install into project scope. crossScope should mention local.
  const result = install({
    target: 'claude',
    scope: 'project',
    cwd: projectRoot,
    packageRoot: makeTempDir('avtest-pkg2-'),
  });
  const r = result.claude as AgentInstallResult;
  expect(r, 'expected claude install result').toBeTruthy();
  expect(Array.isArray(r.crossScope), 'crossScope should be an array').toBeTruthy();
  const otherScopes = (r.crossScope ?? []).map(s => s.scope);
  expect(otherScopes.includes('local'), `expected 'local' in crossScope ${otherScopes.join(',')}`).toBeTruthy();
  expect(!otherScopes.includes('project'), `current scope 'project' must not appear in crossScope`).toBeTruthy();
});

test('EVENTS: l abonnement aux echecs d outil est declare', () => {
  expect(EVENTS.includes('PostToolUseFailure'), 'sans cet evenement, retryStorm ne peut se declencher sur aucune machine').toBeTruthy();
});

// Les cinq evenements que les deux agents partageaient avant PostToolUseFailure.
const EVENTS_COPILOT_ATTENDUS = ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'SessionStart'];

test('EVENTS: la liste de Claude porte l echec, celle de Copilot ne l invente pas', () => {
  expect(_internals.eventsFor('claude').includes('PostToolUseFailure'), 'PostToolUseFailure est un evenement Claude Code : il doit rester declare cote Claude').toBeTruthy();
  expect(_internals.eventsFor('copilot'), 'rien ne prouve que Copilot connaisse PostToolUseFailure : ne pas ecrire ce nom chez lui').toEqual(EVENTS_COPILOT_ATTENDUS);
});

test('installCopilot: le fichier ecrit ne declare que les evenements connus de Copilot', () => {
  const projectRoot = makeTempDir('avtest-copilot-events-');
  fs.mkdirSync(path.join(projectRoot, '.git'));
  const result = install({
    target: 'copilot',
    scope: 'project',
    cwd: projectRoot,
    packageRoot: makeTempDir('avtest-pkg-copilot-'),
  });
  const copilot = result.copilot as AgentInstallResult;
  const written = JSON.parse(fs.readFileSync(copilot.target!.file, 'utf8'));
  expect(Object.keys(written.hooks), 'agent-viz ne doit ecrire aucun nom d evenement non mesure dans la config d un tiers').toEqual(EVENTS_COPILOT_ATTENDUS);
});

test('install: une configuration aux 5 anciens evenements ne gagne que le nouveau', () => {
  const cmd = 'node "C:/x/agent-viz/bin/agent-viz.js" hook';
  const settings = { hooks: {} };
  for (const ev of ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'SessionStart']) {
    _internals.addHook(settings, ev, cmd);
  }
  const missing = _internals.auditSettings(settings, cmd)
    .filter(a => !a.installed)
    .map(a => a.event);
  expect(missing, 'la migration doit ajouter le nouvel evenement sans doublonner les autres').toEqual(['PostToolUseFailure']);
});

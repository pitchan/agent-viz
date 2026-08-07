'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { findProjectRoot, findInstalledScopes, install, resolveScope, EVENTS, _internals } = require('../../lib/install-hooks');

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('findProjectRoot: home dir with .git is NOT recognized as a project', () => {
  const fakeHome = makeTempDir('avtest-home-');
  fs.mkdirSync(path.join(fakeHome, '.git'));
  const result = findProjectRoot(fakeHome, { homedir: fakeHome });
  assert.equal(result, null, 'home dir must not be returned as projectRoot');
});

test('findProjectRoot: packageRoot with .git is NOT recognized as a project', () => {
  const pkgRoot = makeTempDir('avtest-pkg-');
  fs.mkdirSync(path.join(pkgRoot, '.git'));
  const elsewhereHome = makeTempDir('avtest-otherhome-');
  const result = findProjectRoot(pkgRoot, { packageRoot: pkgRoot, homedir: elsewhereHome });
  assert.equal(result, null, 'packageRoot must not be returned as projectRoot');
});

test('findProjectRoot: nested cwd inside a real project still finds the project root', () => {
  const projectRoot = makeTempDir('avtest-proj-');
  fs.mkdirSync(path.join(projectRoot, '.git'));
  const child = path.join(projectRoot, 'src');
  fs.mkdirSync(child);
  const elsewhereHome = makeTempDir('avtest-otherhome2-');
  const result = findProjectRoot(child, { homedir: elsewhereHome });
  assert.equal(result, projectRoot);
});

// Helpers for the cross-scope tests below. We can't intercept os.homedir(), so
// the user scope may or may not have real agent-viz hooks on the dev's box —
// these tests only assert presence of the scopes we explicitly populated.
function writeClaudeSettingsWithHook(file, command = 'node /tmp/agent-viz/lib/hook.js --source=claude') {
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
  const scopes = found.map(f => f.scope);
  assert.ok(scopes.includes('project'), `expected 'project' in ${scopes.join(',')}`);
  assert.ok(scopes.includes('local'), `expected 'local' in ${scopes.join(',')}`);
});

test('install: refreshes existing hook whose timeout drifted (5 → 10)', () => {
  const projectRoot = makeTempDir('avtest-timeout-');
  fs.mkdirSync(path.join(projectRoot, '.git'));
  // Pre-existing hook with the exact desired command BUT obsolete timeout=5.
  // Without the upgrade path, this would noop and the timeout would stay 5.
  const command = 'npx --yes @vcueto/agent-viz@9.9.9-test hook --source=claude';
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
    version: '9.9.9-test',
  });
  const r = result.claude;
  // Une config d'avant PostToolUseFailure : les 5 anciens sont rafraîchis ET le
  // 6e est posé au passage — d'où 'installed+updated' et non 'updated'.
  assert.equal(r.action, 'installed+updated', `expected action='installed+updated', got '${r.action}'`);
  assert.equal(r.updated.length, 5, `expected all 5 events refreshed, got ${r.updated.length}`);
  assert.deepEqual(r.missing, ['PostToolUseFailure'], 'seul le nouvel evenement doit manquer');

  const persisted = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  for (const ev of ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'SessionStart']) {
    const h = persisted.hooks[ev][0].hooks[0];
    assert.equal(h.timeout, 10, `${ev} timeout should be upgraded to 10, got ${h.timeout}`);
    assert.equal(h.command, command, `${ev} command should be preserved`);
  }
});

test('resolveScope: no explicit scope defaults to user (global) even inside a project', () => {
  const projectRoot = makeTempDir('avtest-defscope-');
  fs.mkdirSync(path.join(projectRoot, '.git'));
  for (const agent of ['claude', 'copilot']) {
    const r = resolveScope({ cwd: projectRoot, agent });
    assert.equal(r.scope, 'user', `${agent}: default scope should be 'user', got '${r.scope}'`);
    assert.equal(r.projectRoot, null, `${agent}: user scope must not carry a projectRoot`);
  }
});

test('resolveScope: explicit --local still resolves to the per-repo file', () => {
  const projectRoot = makeTempDir('avtest-localscope-');
  fs.mkdirSync(path.join(projectRoot, '.git'));
  const r = resolveScope({ scope: 'local', cwd: projectRoot, agent: 'claude' });
  assert.equal(r.scope, 'local');
  assert.equal(r.projectRoot, projectRoot);
});

test('resolveScope: explicit --local with no project still throws', () => {
  const lonelyHome = makeTempDir('avtest-noproj-');
  assert.throws(
    () => resolveScope({ scope: 'local', cwd: lonelyHome, agent: 'claude', packageRoot: lonelyHome }),
    /--local requested but no/,
  );
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
    version: '9.9.9-test',
  });
  const r = result.claude;
  assert.ok(r, 'expected claude install result');
  assert.ok(Array.isArray(r.crossScope), 'crossScope should be an array');
  const otherScopes = r.crossScope.map(s => s.scope);
  assert.ok(otherScopes.includes('local'), `expected 'local' in crossScope ${otherScopes.join(',')}`);
  assert.ok(!otherScopes.includes('project'), `current scope 'project' must not appear in crossScope`);
});

test('EVENTS: l abonnement aux echecs d outil est declare', () => {
  assert.ok(EVENTS.includes('PostToolUseFailure'),
    'sans cet evenement, retryStorm ne peut se declencher sur aucune machine');
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
  assert.deepEqual(missing, ['PostToolUseFailure'],
    'la migration doit ajouter le nouvel evenement sans doublonner les autres');
});

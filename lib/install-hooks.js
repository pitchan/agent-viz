#!/usr/bin/env node
'use strict';
// Installe / désinstalle les hooks agent-viz dans un settings.json Claude Code.
// Scopes supportés :
//   user    → ~/.claude/settings.json
//   project → <root>/.claude/settings.json   (committé, partagé équipe)
//   local   → <root>/.claude/settings.local.json (gitignored, machine-locale)
// Idempotent : détecte les hooks déjà présents et n'ajoute que ce qui manque.
//
// Usage CLI standalone :
//   node lib/install-hooks.js [--user|--project|--local] [--check|--uninstall]
//
// API :
//   const { install, uninstall, audit, resolveScope, resolveHookCommand } = require('./install-hooks');

const fs = require('fs');
const path = require('path');
const os = require('os');

const EVENTS = ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'SessionStart'];

// Match three forms used historically + currently:
//   1. node /abs/.../agent-viz/hook.js              (legacy)
//   2. node /abs/.../agent-viz/lib/hook.js          (path-style after refactor)
//   3. node /abs/.../agent-viz/bin/agent-viz.js hook (absolute bin-style)
//   4. agent-viz hook  /  npx agent-viz@X.Y.Z hook   (npx-style)
function isAgentVizHook(h) {
  if (!h || h.type !== 'command' || typeof h.command !== 'string') return false;
  const cmd = h.command.replace(/\\/g, '/');
  if (!cmd.includes('agent-viz')) return false;
  return /\/hook\.js(["'\s]|$)/.test(cmd)
      || /agent-viz(?:@[\w.\-]+)?(?:\.js)?["']?\s+hook\b/.test(cmd);
}

function readSettings(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) {
    if (e.code === 'ENOENT') return {};
    throw new Error(`${file} invalide : ${e.message}`);
  }
}

function writeSettings(file, settings) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n');
}

function hasHookForEvent(settings, event) {
  const entries = settings.hooks?.[event] || [];
  return entries.some(entry => (entry.hooks || []).some(isAgentVizHook));
}

function auditSettings(settings) {
  return EVENTS.map(ev => ({ event: ev, installed: hasHookForEvent(settings, ev) }));
}

function addHook(settings, event, command) {
  settings.hooks ??= {};
  settings.hooks[event] ??= [];
  settings.hooks[event].push({
    hooks: [{ type: 'command', command, timeout: 5 }],
  });
}

function removeHook(settings, event) {
  const arr = settings.hooks?.[event];
  if (!arr) return 0;
  let removed = 0;
  const kept = [];
  for (const entry of arr) {
    const filtered = (entry.hooks || []).filter(h => !isAgentVizHook(h));
    if (filtered.length !== (entry.hooks || []).length) removed++;
    if (filtered.length > 0) kept.push({ ...entry, hooks: filtered });
  }
  if (kept.length === 0) delete settings.hooks[event];
  else settings.hooks[event] = kept;
  return removed;
}

// Walk up from `cwd` looking for a project root marker (.git or package.json).
// Stop at homedir or filesystem root. Returns absolute path or null.
function findProjectRoot(cwd) {
  let dir = path.resolve(cwd);
  const home = os.homedir();
  const root = path.parse(dir).root;
  while (dir && dir !== root && dir !== path.dirname(home)) {
    if (fs.existsSync(path.join(dir, '.git')) || fs.existsSync(path.join(dir, 'package.json'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

// Decide where to write hooks.
//   resolveScope({ scope: 'user'|'project'|'local'|undefined, cwd })
//     → { scope, file, projectRoot }
// Defaults:
//   - explicit scope → respected
//   - no scope, project detected → 'local' (gitignored, machine-local)
//   - no scope, no project       → 'user'
function resolveScope({ scope, cwd } = {}) {
  cwd = cwd || process.cwd();
  if (scope === 'user') {
    return { scope: 'user', file: path.join(os.homedir(), '.claude', 'settings.json'), projectRoot: null };
  }
  const projectRoot = findProjectRoot(cwd);
  if (scope === 'project') {
    if (!projectRoot) throw new Error('--project requested but no .git/ or package.json found from cwd');
    return { scope: 'project', file: path.join(projectRoot, '.claude', 'settings.json'), projectRoot };
  }
  if (scope === 'local') {
    if (!projectRoot) throw new Error('--local requested but no .git/ or package.json found from cwd');
    return { scope: 'local', file: path.join(projectRoot, '.claude', 'settings.local.json'), projectRoot };
  }
  // Auto: prefer project-local if inside a project, else user.
  if (projectRoot) {
    return { scope: 'local', file: path.join(projectRoot, '.claude', 'settings.local.json'), projectRoot };
  }
  return { scope: 'user', file: path.join(os.homedir(), '.claude', 'settings.json'), projectRoot: null };
}

// Decide what command string to embed in settings.json.
// Strategy:
//   - If the binary is on a stable absolute path (not under os.tmpdir() and not
//     in an /_npx/ cache), embed `node "<abs>/bin/agent-viz.js" hook` (fast).
//   - Otherwise (ephemeral npx cache), use `npx --yes agent-viz@<version> hook`
//     pinned to the currently-running version (portable, ~300-800ms cold start).
function resolveHookCommand({ packageRoot, version } = {}) {
  packageRoot = packageRoot || path.resolve(__dirname, '..');
  const binPath = path.join(packageRoot, 'bin', 'agent-viz.js');
  // Detect ephemeral npx cache. npx uses paths containing "/_npx/" on every
  // platform (e.g. ~/.npm/_npx/<hash>/...). os.tmpdir() alone is not a reliable
  // signal — users routinely run from /tmp scratch dirs that aren't ephemeral.
  const isEphemeral = packageRoot.includes(`${path.sep}_npx${path.sep}`)
                   || packageRoot.includes('/_npx/');
  if (!isEphemeral && fs.existsSync(binPath)) {
    const norm = binPath.replace(/\\/g, '/');
    return { command: `node "${norm}" hook`, mode: 'absolute', path: norm };
  }
  let v = version;
  if (!v) {
    try { v = require(path.join(packageRoot, 'package.json')).version; } catch {}
  }
  const spec = v ? `agent-viz@${v}` : 'agent-viz';
  return { command: `npx --yes ${spec} hook`, mode: 'npx', spec };
}

// .gitignore handling for project-local installs.
// If a .gitignore exists at projectRoot and doesn't already ignore the local
// settings file (or .claude/), append a line. Idempotent.
function ensureGitignore(projectRoot) {
  const gi = path.join(projectRoot, '.gitignore');
  if (!fs.existsSync(gi)) return { changed: false, reason: 'no .gitignore (skipped)' };
  const content = fs.readFileSync(gi, 'utf8');
  const lines = content.split('\n').map(l => l.trim());
  const target = '.claude/settings.local.json';
  const alreadyIgnored = lines.some(l =>
    l === target ||
    l === '.claude/' ||
    l === '.claude' ||
    l === '.claude/*.local.json' ||
    l === '*.local.json'
  );
  if (alreadyIgnored) return { changed: false, reason: 'already ignored' };
  const sep = content.endsWith('\n') ? '' : '\n';
  fs.appendFileSync(gi, `${sep}${target}\n`);
  return { changed: true };
}

// ── High-level API ──

function audit({ scope, cwd } = {}) {
  const target = resolveScope({ scope, cwd });
  const settings = readSettings(target.file);
  return { ...target, audit: auditSettings(settings) };
}

function install({ scope, cwd, packageRoot, version } = {}) {
  const target = resolveScope({ scope, cwd });
  const settings = readSettings(target.file);
  const audit = auditSettings(settings);
  const missing = audit.filter(a => !a.installed).map(a => a.event);
  const present = audit.filter(a => a.installed).map(a => a.event);
  const cmd = resolveHookCommand({ packageRoot, version });

  if (missing.length === 0) {
    return { target, action: 'noop', missing, present, command: cmd };
  }
  for (const ev of missing) addHook(settings, ev, cmd.command);
  writeSettings(target.file, settings);

  let gitignore = null;
  if (target.scope === 'local' && target.projectRoot) {
    gitignore = ensureGitignore(target.projectRoot);
  }
  return { target, action: 'installed', missing, present, command: cmd, gitignore };
}

function uninstall({ scope, cwd } = {}) {
  // If scope is explicit, only that scope. Otherwise scan all 3 and report
  // every removal — useful for "clean up everywhere" workflows.
  const targets = [];
  if (scope) {
    targets.push(resolveScope({ scope, cwd }));
  } else {
    // user
    targets.push({ scope: 'user', file: path.join(os.homedir(), '.claude', 'settings.json'), projectRoot: null });
    const projectRoot = findProjectRoot(cwd || process.cwd());
    if (projectRoot) {
      targets.push({ scope: 'project', file: path.join(projectRoot, '.claude', 'settings.json'), projectRoot });
      targets.push({ scope: 'local', file: path.join(projectRoot, '.claude', 'settings.local.json'), projectRoot });
    }
  }
  const results = [];
  for (const t of targets) {
    if (!fs.existsSync(t.file)) {
      results.push({ ...t, removed: 0, exists: false });
      continue;
    }
    const settings = readSettings(t.file);
    let total = 0;
    for (const ev of EVENTS) total += removeHook(settings, ev);
    if (total > 0) writeSettings(t.file, settings);
    results.push({ ...t, removed: total, exists: true });
  }
  return { results };
}

module.exports = {
  EVENTS,
  isAgentVizHook,
  audit,
  install,
  uninstall,
  resolveScope,
  resolveHookCommand,
  findProjectRoot,
  ensureGitignore,
  // exposed for tests / advanced use:
  _internals: { readSettings, writeSettings, auditSettings, addHook, removeHook, hasHookForEvent },
};

// ── CLI standalone (kept for backwards compatibility) ──
function parseCliArgs(argv) {
  const out = { mode: 'install', scope: undefined };
  for (const a of argv) {
    if (a === '--check') out.mode = 'check';
    else if (a === '--uninstall') out.mode = 'uninstall';
    else if (a === '--install') out.mode = 'install';
    else if (a === '--user') out.scope = 'user';
    else if (a === '--project') out.scope = 'project';
    else if (a === '--local') out.scope = 'local';
  }
  return out;
}

function cliMain(argv) {
  const { mode, scope } = parseCliArgs(argv);
  const cwd = process.cwd();

  if (mode === 'check') {
    const { file, scope: s, audit: rows } = audit({ scope, cwd });
    console.log(`settings : ${file}  (scope: ${s})`);
    for (const { event, installed } of rows) {
      console.log(`  [${installed ? 'x' : ' '}] ${event}`);
    }
    const missing = rows.filter(r => !r.installed);
    if (missing.length === 0) {
      console.log('✓ Tous les hooks sont installés.');
      process.exit(0);
    }
    console.log(`✗ Manquants : ${missing.map(m => m.event).join(', ')}`);
    process.exit(1);
  }

  if (mode === 'uninstall') {
    const { results } = uninstall({ scope, cwd });
    let total = 0;
    for (const r of results) {
      total += r.removed;
      if (r.removed > 0) console.log(`✓ ${r.removed} retiré(s) de ${r.file} (${r.scope})`);
      else if (r.exists) console.log(`  rien à retirer dans ${r.file} (${r.scope})`);
    }
    if (total === 0) console.log('Aucun hook agent-viz trouvé.');
    return;
  }

  // install
  const result = install({ scope, cwd });
  console.log(`settings : ${result.target.file}  (scope: ${result.target.scope})`);
  console.log(`hook cmd : ${result.command.command}  (mode: ${result.command.mode})`);
  if (result.action === 'noop') {
    console.log('✓ Déjà installé — rien à faire.');
    return;
  }
  console.log(`✓ Ajouté sur : ${result.missing.join(', ')}`);
  if (result.present.length > 0) console.log(`  (déjà présent sur : ${result.present.join(', ')})`);
  if (result.gitignore && result.gitignore.changed) {
    console.log('  + .gitignore : ajout de .claude/settings.local.json');
  }
  console.log('\n→ Ouvre /hooks dans Claude Code (ou relance) pour que la config soit rechargée.');
}

if (require.main === module) {
  try { cliMain(process.argv.slice(2)); }
  catch (e) { console.error('Erreur :', e.message); process.exit(2); }
}

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

// Per-agent paths + gitignore entry. Add a third agent here, then map it in
// detectAgents() and resolveTargets().
const AGENT_CONFIG = {
  claude: {
    userFile: () => path.join(os.homedir(), '.claude', 'settings.json'),
    projectFile: (root) => path.join(root, '.claude', 'settings.json'),
    localFile: (root) => path.join(root, '.claude', 'settings.local.json'),
    gitignoreEntry: '.claude/settings.local.json',
  },
  copilot: {
    userFile: () => path.join(os.homedir(), '.copilot', 'hooks', 'agent-viz.json'),
    projectFile: (root) => path.join(root, '.github', 'hooks', 'agent-viz.json'),
    localFile: (root) => path.join(root, '.github', 'hooks', 'agent-viz.local.json'),
    gitignoreEntry: '.github/hooks/agent-viz.local.json',
  },
};

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

// "Standard shape" = a command resolveHookCommand would actually produce
// (node "<path>" hook  OR  npx ... agent-viz... hook). We only auto-update
// stale entries that match this shape, so we never overwrite a hand-rolled
// wrapper command the user added on purpose.
function isStandardShape(cmd) {
  if (typeof cmd !== 'string') return false;
  const trimmed = cmd.trim();
  return /^node\s+["']/.test(trimmed) || /^npx\s/.test(trimmed);
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

// Inspect a single event slot. Returns:
//   { present: bool      — at least one agent-viz hook is registered
//     stale:   bool      — an agent-viz hook of standard shape has a command
//                          ≠ desiredCommand (e.g. broken absolute path,
//                          obsolete npx version)
//     others:  number    — count of non-agent-viz hooks on the same event
//                          (these will run in parallel with ours)
//   }
function inspectEvent(settings, event, desiredCommand) {
  const entries = settings.hooks?.[event] || [];
  let present = false;
  let stale = false;
  let others = 0;
  for (const entry of entries) {
    for (const h of entry.hooks || []) {
      if (isAgentVizHook(h)) {
        present = true;
        if (desiredCommand && isStandardShape(h.command) && h.command !== desiredCommand) {
          stale = true;
        }
      } else {
        others++;
      }
    }
  }
  return { present, stale, others };
}

function auditSettings(settings, desiredCommand) {
  return EVENTS.map(ev => {
    const info = inspectEvent(settings, ev, desiredCommand);
    return { event: ev, installed: info.present, stale: info.stale, others: info.others };
  });
}

// Rewrite the command of every standard-shape agent-viz hook on `event` to
// `desiredCommand`. Custom-wrapper commands (non-standard shape) are left
// alone. Returns the count of entries actually mutated.
function refreshStaleCommand(settings, event, desiredCommand) {
  const entries = settings.hooks?.[event] || [];
  let updated = 0;
  for (const entry of entries) {
    for (const h of entry.hooks || []) {
      if (isAgentVizHook(h) && isStandardShape(h.command) && h.command !== desiredCommand) {
        h.command = desiredCommand;
        updated++;
      }
    }
  }
  return updated;
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

// Detect which CLI agents are present on the system. Used to default `target`
// when the caller didn't specify. We accept either: binary on PATH, OR the
// agent's config home dir exists with at least one file.
function detectAgents({ cwd } = {}) {
  const home = os.homedir();
  function dirHasFiles(p) {
    try { return fs.readdirSync(p).length > 0; } catch { return false; }
  }
  function inPath(name) {
    const PATH = process.env.PATH || '';
    const sep = process.platform === 'win32' ? ';' : ':';
    const exts = process.platform === 'win32' ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';') : [''];
    for (const dir of PATH.split(sep)) {
      if (!dir) continue;
      for (const ext of exts) {
        try { if (fs.existsSync(path.join(dir, name + ext))) return true; } catch {}
      }
    }
    return false;
  }
  return {
    claude: inPath('claude') || fs.existsSync(path.join(home, '.claude', 'settings.json')),
    copilot: inPath('copilot') || dirHasFiles(path.join(home, '.copilot')),
  };
}

// Decide where to write hooks.
//   resolveScope({ scope: 'user'|'project'|'local'|undefined, cwd, agent })
//     → { scope, file, projectRoot }
// Defaults: explicit scope respected; no scope + project detected → 'local'
// (gitignored, machine-local); no scope, no project → 'user'.
function resolveScope({ scope, cwd, agent = 'claude' } = {}) {
  const cfg = AGENT_CONFIG[agent];
  cwd = cwd || process.cwd();
  if (scope === 'user') {
    return { scope: 'user', file: cfg.userFile(), projectRoot: null };
  }
  const projectRoot = findProjectRoot(cwd);
  if (scope === 'project') {
    if (!projectRoot) throw new Error('--project requested but no .git/ or package.json found from cwd');
    return { scope: 'project', file: cfg.projectFile(projectRoot), projectRoot };
  }
  if (scope === 'local') {
    if (!projectRoot) throw new Error('--local requested but no .git/ or package.json found from cwd');
    return { scope: 'local', file: cfg.localFile(projectRoot), projectRoot };
  }
  if (projectRoot) {
    return { scope: 'local', file: cfg.localFile(projectRoot), projectRoot };
  }
  return { scope: 'user', file: cfg.userFile(), projectRoot: null };
}

// Decide what command string to embed in agent settings.
// If the binary is on a stable absolute path (not in an /_npx/ cache), embed
// `node "<abs>/bin/agent-viz.js" hook --source=<agent>` (fast). Otherwise use
// `npx --yes agent-viz@<version> hook --source=<agent>` pinned to the
// currently-running version (~300-800ms cold start).
function resolveHookCommand({ packageRoot, version, agent = 'claude' } = {}) {
  packageRoot = packageRoot || path.resolve(__dirname, '..');
  const binPath = path.join(packageRoot, 'bin', 'agent-viz.js');
  // npx caches always live under "/_npx/" on every platform.
  const isEphemeral = packageRoot.includes(`${path.sep}_npx${path.sep}`)
                   || packageRoot.includes('/_npx/');
  if (!isEphemeral && fs.existsSync(binPath)) {
    const norm = binPath.replace(/\\/g, '/');
    return { command: `node "${norm}" hook --source=${agent}`, mode: 'absolute', path: norm };
  }
  let v = version;
  if (!v) {
    try { v = require(path.join(packageRoot, 'package.json')).version; } catch {}
  }
  const spec = v ? `agent-viz@${v}` : 'agent-viz';
  return { command: `npx --yes ${spec} hook --source=${agent}`, mode: 'npx', spec };
}

// Append the local-scope file to .gitignore if not already covered. No-op when
// .gitignore doesn't exist (we don't create one). Idempotent. `extraPatterns`
// holds historical broader patterns we accept as "already ignored".
function ensureGitignore(projectRoot, target, extraPatterns = []) {
  const gi = path.join(projectRoot, '.gitignore');
  if (!fs.existsSync(gi)) return { changed: false, reason: 'no .gitignore (skipped)' };
  const content = fs.readFileSync(gi, 'utf8');
  const lines = content.split('\n').map(l => l.trim());
  const accepted = new Set([target, ...extraPatterns]);
  if (lines.some(l => accepted.has(l))) return { changed: false, reason: 'already ignored' };
  const sep = content.endsWith('\n') ? '' : '\n';
  fs.appendFileSync(gi, `${sep}${target}\n`);
  return { changed: true };
}

// Per-agent broader patterns that count as "already covers our local file".
const GITIGNORE_EXTRAS = {
  claude: ['.claude/', '.claude', '.claude/*.local.json', '*.local.json'],
  copilot: ['.github/hooks/', '.github/hooks/*.local.json'],
};

// ── Copilot helpers ──

// Recognize either form of a Copilot hook entry's command (bash or powershell).
function copilotEntryCommand(entry) {
  return entry && (entry.bash || entry.powershell);
}
function isAgentVizCommand(cmd) {
  return typeof cmd === 'string' && /agent-viz/.test(cmd) && /\bhook\b/.test(cmd);
}

// Build the JSON content for a Copilot hooks.json file. Same node command in
// both bash and powershell keys — node is cross-platform. timeoutSec mirrors
// Claude's `timeout: 5` (seconds).
function buildCopilotHookFile(command) {
  const entry = { type: 'command', bash: command, powershell: command, timeoutSec: 5 };
  const hooks = {};
  for (const ev of EVENTS) hooks[ev] = [entry];
  return { version: 1, hooks };
}

function readCopilotFile(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) {
    if (e.code === 'ENOENT') return null;
    throw new Error(`${file} invalid : ${e.message}`);
  }
}

// True if the file shape matches what buildCopilotHookFile produced AND any
// entry's command mentions agent-viz hook.
function isAgentVizCopilotFile(content) {
  if (!content || typeof content !== 'object') return false;
  if (content.version !== 1 || !content.hooks) return false;
  for (const ev of EVENTS) {
    for (const e of content.hooks[ev] || []) {
      if (isAgentVizCommand(copilotEntryCommand(e))) return true;
    }
  }
  return false;
}

function auditCopilot({ scope, cwd, packageRoot, version } = {}) {
  const target = resolveScope({ scope, cwd, agent: 'copilot' });
  const cmd = resolveHookCommand({ packageRoot, version, agent: 'copilot' });
  const content = readCopilotFile(target.file);
  const rows = EVENTS.map(ev => {
    const entries = (content && content.hooks && content.hooks[ev]) || [];
    let installed = false, stale = false, others = 0;
    for (const e of entries) {
      const c = copilotEntryCommand(e);
      if (isAgentVizCommand(c)) {
        installed = true;
        if (c !== cmd.command) stale = true;
      } else {
        others++;
      }
    }
    return { event: ev, installed, stale, others };
  });
  return { ...target, audit: rows, command: cmd };
}

function installCopilot({ scope, cwd, packageRoot, version } = {}) {
  const target = resolveScope({ scope, cwd, agent: 'copilot' });
  const cmd = resolveHookCommand({ packageRoot, version, agent: 'copilot' });
  const desired = buildCopilotHookFile(cmd.command);
  const existing = readCopilotFile(target.file);

  let action = 'noop';
  let missing = [];
  let updated = [];
  let present = [];
  const coexisting = {};

  if (!existing) {
    action = 'installed';
    missing = [...EVENTS];
  } else if (!isAgentVizCopilotFile(existing)) {
    // File exists under our name but isn't ours — refuse to overwrite.
    throw new Error(`refusing to overwrite ${target.file}: not an agent-viz hooks file`);
  } else {
    for (const ev of EVENTS) {
      const arr = (existing.hooks && existing.hooks[ev]) || [];
      const ours = arr.find(e => isAgentVizCommand(copilotEntryCommand(e)));
      const others = arr.filter(e => e !== ours).length;
      if (others > 0) coexisting[ev] = others;
      if (!ours) missing.push(ev);
      else if (copilotEntryCommand(ours) !== cmd.command) updated.push(ev);
      else present.push(ev);
    }
    if (missing.length === 0 && updated.length === 0) {
      return { target, action: 'noop', missing, updated, present, coexisting, command: cmd };
    }
    action = (missing.length && updated.length) ? 'installed+updated'
           : missing.length ? 'installed' : 'updated';
  }

  fs.mkdirSync(path.dirname(target.file), { recursive: true });
  fs.writeFileSync(target.file, JSON.stringify(desired, null, 2) + '\n');

  let gitignore = null;
  if (target.scope === 'local' && target.projectRoot) {
    gitignore = ensureGitignore(target.projectRoot, AGENT_CONFIG.copilot.gitignoreEntry, GITIGNORE_EXTRAS.copilot);
  }

  return { target, action, missing, updated, present, coexisting, command: cmd, gitignore };
}

// All scopes the agent uses, in sweep order. Used by uninstall for "no scope"
// (clean everywhere) mode.
function copilotSweepTargets(cwd) {
  const out = [{ scope: 'user', file: AGENT_CONFIG.copilot.userFile(), projectRoot: null }];
  const projectRoot = findProjectRoot(cwd || process.cwd());
  if (projectRoot) {
    out.push({ scope: 'project', file: AGENT_CONFIG.copilot.projectFile(projectRoot), projectRoot });
    out.push({ scope: 'local', file: AGENT_CONFIG.copilot.localFile(projectRoot), projectRoot });
  }
  return out;
}

function uninstallCopilot({ scope, cwd } = {}) {
  const targets = scope
    ? [resolveScope({ scope, cwd, agent: 'copilot' })]
    : copilotSweepTargets(cwd);
  const results = [];
  for (const t of targets) {
    if (!fs.existsSync(t.file)) {
      results.push({ ...t, removed: 0, exists: false });
      continue;
    }
    const content = readCopilotFile(t.file);
    if (isAgentVizCopilotFile(content)) {
      try { fs.unlinkSync(t.file); } catch {}
      results.push({ ...t, removed: EVENTS.length, exists: true });
    } else {
      results.push({ ...t, removed: 0, exists: true });
    }
  }
  return { results };
}

// ── High-level API ──

function auditClaude({ scope, cwd, packageRoot, version } = {}) {
  const target = resolveScope({ scope, cwd });
  const settings = readSettings(target.file);
  const cmd = resolveHookCommand({ packageRoot, version });
  return { ...target, audit: auditSettings(settings, cmd.command), command: cmd };
}

// Install / refresh agent-viz hooks. Returns:
//   action: 'noop' | 'installed' | 'updated' | 'installed+updated'
//   missing:    events where no agent-viz hook existed (now added)
//   updated:    events where a stale standard-shape command was rewritten
//   present:    events where an up-to-date agent-viz hook was already there
//   coexisting: { event: count } — non-agent-viz hooks sharing the same events
//                (informational; they will run in parallel, we never touch them)
function installClaude({ scope, cwd, packageRoot, version } = {}) {
  const target = resolveScope({ scope, cwd });
  const settings = readSettings(target.file);
  const cmd = resolveHookCommand({ packageRoot, version });

  const missing = [];
  const updated = [];
  const present = [];
  const coexisting = {};
  for (const ev of EVENTS) {
    const info = inspectEvent(settings, ev, cmd.command);
    if (info.others > 0) coexisting[ev] = info.others;
    if (!info.present) missing.push(ev);
    else if (info.stale) updated.push(ev);
    else present.push(ev);
  }

  if (missing.length === 0 && updated.length === 0) {
    return { target, action: 'noop', missing, updated, present, coexisting, command: cmd };
  }

  for (const ev of updated) refreshStaleCommand(settings, ev, cmd.command);
  for (const ev of missing) addHook(settings, ev, cmd.command);
  writeSettings(target.file, settings);

  let gitignore = null;
  if (target.scope === 'local' && target.projectRoot) {
    gitignore = ensureGitignore(target.projectRoot, AGENT_CONFIG.claude.gitignoreEntry, GITIGNORE_EXTRAS.claude);
  }

  let action;
  if (missing.length > 0 && updated.length > 0) action = 'installed+updated';
  else if (missing.length > 0) action = 'installed';
  else action = 'updated';

  return { target, action, missing, updated, present, coexisting, command: cmd, gitignore };
}

function claudeSweepTargets(cwd) {
  const out = [{ scope: 'user', file: AGENT_CONFIG.claude.userFile(), projectRoot: null }];
  const projectRoot = findProjectRoot(cwd || process.cwd());
  if (projectRoot) {
    out.push({ scope: 'project', file: AGENT_CONFIG.claude.projectFile(projectRoot), projectRoot });
    out.push({ scope: 'local', file: AGENT_CONFIG.claude.localFile(projectRoot), projectRoot });
  }
  return out;
}

function uninstallClaude({ scope, cwd } = {}) {
  const targets = scope
    ? [resolveScope({ scope, cwd })]
    : claudeSweepTargets(cwd);
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

// ── Multi-agent dispatchers (public API) ──
//
// `target`: 'claude' | 'copilot' | 'both' | undefined.
// undefined → auto-detect; uninstall always sweeps both (don't leave hooks
// behind if an agent got removed from PATH after install).
// Returns { claude?, copilot? } where each side carries the per-agent result.

function resolveTargets({ target, cwd }) {
  if (target === 'claude') return { claude: true, copilot: false };
  if (target === 'copilot') return { claude: false, copilot: true };
  if (target === 'both') return { claude: true, copilot: true };
  const detected = detectAgents({ cwd });
  if (!detected.claude && !detected.copilot) return { claude: true, copilot: false };
  return detected;
}

function install({ target, scope, cwd, packageRoot, version } = {}) {
  const t = resolveTargets({ target, cwd });
  const out = {};
  if (t.claude) out.claude = installClaude({ scope, cwd, packageRoot, version });
  if (t.copilot) out.copilot = installCopilot({ scope, cwd, packageRoot, version });
  return out;
}

function uninstall({ target, scope, cwd } = {}) {
  const t = target ? resolveTargets({ target, cwd }) : { claude: true, copilot: true };
  const out = {};
  if (t.claude) out.claude = uninstallClaude({ scope, cwd });
  if (t.copilot) out.copilot = uninstallCopilot({ scope, cwd });
  return out;
}

function audit({ target, scope, cwd, packageRoot, version } = {}) {
  const t = resolveTargets({ target, cwd });
  const out = {};
  if (t.claude) out.claude = auditClaude({ scope, cwd, packageRoot, version });
  if (t.copilot) out.copilot = auditCopilot({ scope, cwd, packageRoot, version });
  return out;
}

module.exports = {
  EVENTS,
  isAgentVizHook,
  isStandardShape,
  detectAgents,
  install,
  uninstall,
  audit,
  resolveScope,
  resolveHookCommand,
  findProjectRoot,
  ensureGitignore,
  _internals: {
    readSettings, writeSettings, auditSettings, addHook, removeHook,
    hasHookForEvent, inspectEvent, refreshStaleCommand,
  },
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
    const result = audit({ scope, cwd });
    let allGood = true;
    for (const [agent, a] of Object.entries(result)) {
      console.log(`[${agent}] settings : ${a.file}  (scope: ${a.scope})`);
      for (const { event, installed, stale, others } of a.audit) {
        const flag = installed ? (stale ? '~' : 'x') : ' ';
        const tags = [];
        if (stale) tags.push('stale');
        if (others > 0) tags.push(`+${others} other`);
        console.log(`[${agent}]   [${flag}] ${event}${tags.length ? '   (' + tags.join(', ') + ')' : ''}`);
        if (!installed || stale) allGood = false;
      }
    }
    process.exit(allGood ? 0 : 1);
  }

  if (mode === 'uninstall') {
    const result = uninstall({ scope, cwd });
    let total = 0;
    for (const [agent, x] of Object.entries(result)) {
      const results = x.results || [];
      for (const r of results) {
        total += r.removed;
        if (r.removed > 0) console.log(`[${agent}] ✓ retiré ${r.removed} de ${r.file} (${r.scope})`);
        else if (r.exists) console.log(`[${agent}]   rien à retirer dans ${r.file} (${r.scope})`);
      }
    }
    if (total === 0) console.log('Aucun hook agent-viz trouvé.');
    return;
  }

  // install
  const result = install({ scope, cwd });
  if (result.claude) {
    const r = result.claude;
    console.log(`[claude] settings : ${r.target.file}  (scope: ${r.target.scope})`);
    console.log(`[claude] hook cmd : ${r.command.command}  (mode: ${r.command.mode})`);
    if (r.action === 'noop') console.log('[claude] ✓ déjà installé et à jour.');
    else {
      if (r.missing.length > 0) console.log(`[claude] ✓ Ajouté sur : ${r.missing.join(', ')}`);
      if (r.updated.length > 0) console.log(`[claude] ✓ Rafraîchi sur : ${r.updated.join(', ')}`);
    }
  }
  if (result.copilot) {
    const r = result.copilot;
    if (r.error) {
      console.log(`[copilot] ! ${r.error}`);
    } else {
      console.log(`[copilot] file : ${r.target.file}  (scope: ${r.target.scope})`);
      console.log(`[copilot] hook cmd : ${r.command.command}  (mode: ${r.command.mode})`);
      if (r.action === 'noop') console.log('[copilot] ✓ déjà installé et à jour.');
      else console.log(`[copilot] ✓ ${r.action}`);
    }
  }
}

if (require.main === module) {
  try { cliMain(process.argv.slice(2)); }
  catch (e) { console.error('Erreur :', e.message); process.exit(2); }
}

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
//   node src/server/install-hooks.js [--user|--project|--local] [--check|--uninstall]
//
// API :
//   import { install, uninstall, audit, resolveScope, resolveHookCommand } from './install-hooks.ts';

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

import type { AgentName, Scope, AgentOpts, ResolvedTarget, ResolvedCommand } from './install-hooks/types.ts';
import { HOOK_TIMEOUT_SEC } from './install-hooks/types.ts';
import { AGENT_CONFIG, GITIGNORE_EXTRAS, EVENTS, eventsFor } from './install-hooks/config.ts';
import {
  isAgentVizHook, isStandardShape, readSettings, writeSettings, addHook,
  removeHook, hasHookForEvent, inspectEvent, refreshStaleCommand,
  type ClaudeSettings,
} from './install-hooks/settings-io.ts';

// ── Types ──
//
// Vocabulaire commun à ce fichier : le fichier de hooks Copilot n'est typé que
// sur ce que CE fichier lit/écrit réellement — une index signature ouverte
// tolère le reste.

interface CopilotHookEntry {
  type: string;
  bash?: string;
  powershell?: string;
  timeoutSec?: number;
  [key: string]: unknown;
}
interface CopilotHooksFile {
  version: number;
  hooks: Record<string, CopilotHookEntry[]>;
}

// Un objet exploitable par accès de champ — même garde locale que les autres
// fichiers du serveur : `JSON.parse` ne promet qu'un JSON valide, pas un objet.
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function auditSettings(
  settings: ClaudeSettings, desiredCommand: string | undefined,
): Array<{ event: string; installed: boolean; stale: boolean; others: number }> {
  return EVENTS.map(ev => {
    const info = inspectEvent(settings, ev, desiredCommand);
    return { event: ev, installed: info.present, stale: info.stale, others: info.others };
  });
}

// Walk up from `cwd` looking for a project root marker (.git or package.json).
// Stop at homedir or filesystem root. Returns absolute path or null.
//
// Two skip rules: the home directory itself never counts as a project (a .git
// in ~ is a dotfiles repo, not a project we want to install hooks into), and
// the agent-viz package root never counts either (auto-install ran from
// inside the agent-viz checkout would otherwise scope hooks to the repo
// itself, useful to nobody). Both skips fall through to user scope.
function findProjectRoot(
  cwd: string, { packageRoot, homedir = os.homedir() }: { packageRoot?: string; homedir?: string } = {},
): string | null {
  let dir = path.resolve(cwd);
  const root = path.parse(dir).root;
  while (dir && dir !== root && dir !== path.dirname(homedir)) {
    if (dir === homedir) { dir = path.dirname(dir); continue; }
    if (packageRoot && dir === packageRoot) { dir = path.dirname(dir); continue; }
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
//   resolveScope({ scope: 'user'|'project'|'local'|undefined, cwd, agent })
//     → { scope, file, projectRoot }
// Defaults: explicit scope respected; no scope → 'user' (global), for every
// agent. A user-scope hook fires from any directory, so an agent session
// launched outside the install directory is still captured. The previous
// default ('local' when a project was detected) only registered the hook for
// that one project — sessions run from anywhere else silently produced no
// events. This mirrors how agent-viz itself is installed: globally.
function resolveScope({ scope, cwd, agent = 'claude', packageRoot }: AgentOpts = {}): ResolvedTarget {
  const cfg = AGENT_CONFIG[agent];
  cwd = cwd || process.cwd();
  if (!scope || scope === 'user') {
    return { scope: 'user', file: cfg.userFile(), projectRoot: null };
  }
  const projectRoot = findProjectRoot(cwd, { packageRoot });
  if (scope === 'project') {
    if (!projectRoot) throw new Error('--project requested but no .git/ or package.json found from cwd');
    return { scope: 'project', file: cfg.projectFile(projectRoot), projectRoot };
  }
  // scope === 'local'
  if (!projectRoot) throw new Error('--local requested but no .git/ or package.json found from cwd');
  return { scope: 'local', file: cfg.localFile(projectRoot), projectRoot };
}

// Decide what command string to embed in agent settings.
// If the binary is on a stable absolute path (not in an /_npx/ cache), embed
// `node "<abs>/bin/agent-viz.js" hook --source=<agent>` (fast). Otherwise use
// `npx --yes @vcueto/agent-viz@<version> hook --source=<agent>` pinned to the
// currently-running version (~300-800ms cold start).
function resolveHookCommand({ packageRoot, version, agent = 'claude' }: AgentOpts = {}): ResolvedCommand {
  packageRoot = packageRoot || path.resolve(import.meta.dirname, '..', '..');
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
    // BOM retire avant l analyse (constat C1, idiome de hook.js:64) : sans lui,
    // un package.json prefixe rendrait un spec npx SANS version, en silence.
    try {
      const brut = fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8');
      const pkg: unknown = JSON.parse(brut.charCodeAt(0) === 0xFEFF ? brut.slice(1) : brut);
      if (isRecord(pkg) && typeof pkg.version === 'string') v = pkg.version;
    } catch {}
  }
  const spec = v ? `@vcueto/agent-viz@${v}` : '@vcueto/agent-viz';
  return { command: `npx --yes ${spec} hook --source=${agent}`, mode: 'npx', spec };
}

// Append the local-scope file to .gitignore if not already covered. No-op when
// .gitignore doesn't exist (we don't create one). Idempotent. `extraPatterns`
// holds historical broader patterns we accept as "already ignored".
function ensureGitignore(
  projectRoot: string, target: string, extraPatterns: string[] = [],
): { changed: boolean; reason?: string } {
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

// ── Copilot helpers ──

// Recognize either form of a Copilot hook entry's command (bash or powershell).
function copilotEntryCommand(entry: unknown): string | undefined {
  if (!isRecord(entry)) return undefined;
  const bash = typeof entry.bash === 'string' ? entry.bash : undefined;
  const powershell = typeof entry.powershell === 'string' ? entry.powershell : undefined;
  return bash || powershell;
}
function isAgentVizCommand(cmd: unknown): boolean {
  return typeof cmd === 'string' && /agent-viz/.test(cmd) && /\bhook\b/.test(cmd);
}

// Build the JSON content for a Copilot hooks.json file. Same node command in
// both bash and powershell keys — node is cross-platform. timeoutSec mirrors
// Claude's `timeout` setting. See HOOK_TIMEOUT_SEC comment for the rationale.
function buildCopilotHookFile(command: string): CopilotHooksFile {
  const entry: CopilotHookEntry = { type: 'command', bash: command, powershell: command, timeoutSec: HOOK_TIMEOUT_SEC };
  const hooks: Record<string, CopilotHookEntry[]> = {};
  for (const ev of eventsFor('copilot')) hooks[ev] = [entry];
  return { version: 1, hooks };
}

// Retour `unknown`, PAS `CopilotHooksFile | null` : `JSON.parse` d'un fichier
// disque ne garantit RIEN sur sa forme — un `agent-viz.json` JSON-valide sans
// clé `hooks` est un contenu réel possible, pas une impossibilité que le type
// pourrait légitimement écarter. Prétendre `CopilotHooksFile` ici (revue du
// 2026-08-14, constat 1) avait fait disparaître la garde `content.hooks &&`
// dans `auditCopilot` sur la foi d'un type qui mentait : `.hooks` non
// optionnel semblait rendre le test redondant, alors que rien sur le disque
// ne le garantissait. Chaque appelant doit donc valider lui-même — via
// `isAgentVizCopilotFile` (qui vérifie `isRecord(content.hooks)` avant de
// rendre `true`) ou, pour une lecture simplement défensive comme
// `auditCopilot`, via le même garde explicite.
function readCopilotFile(file: string): unknown {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e: unknown) {
    if (e instanceof Error && 'code' in e && e.code === 'ENOENT') return null;
    const message = e instanceof Error ? e.message : String(e);
    throw new Error(`${file} invalid : ${message}`);
  }
}

// True if the file shape matches what buildCopilotHookFile produced AND any
// entry's command mentions agent-viz hook.
function isAgentVizCopilotFile(content: unknown): content is CopilotHooksFile {
  if (!isRecord(content)) return false;
  if (content.version !== 1 || !isRecord(content.hooks)) return false;
  const hooks = content.hooks as Record<string, unknown>;
  for (const ev of eventsFor('copilot')) {
    const entries = hooks[ev];
    if (!Array.isArray(entries)) continue;
    for (const e of entries) {
      if (isAgentVizCommand(copilotEntryCommand(e))) return true;
    }
  }
  return false;
}

function auditCopilot({ scope, cwd, packageRoot, version }: AgentOpts = {}) {
  const target = resolveScope({ scope, cwd, agent: 'copilot', packageRoot });
  const cmd = resolveHookCommand({ packageRoot, version, agent: 'copilot' });
  const content = readCopilotFile(target.file);
  // Restaure le garde à trois niveaux de l'original (`content && content.hooks
  // && content.hooks[ev]`) — `content` est `unknown` (voir `readCopilotFile`) :
  // un fichier JSON-valide sans `hooks` rend `hooksMap` `undefined` ici, comme
  // avant, plutôt qu'un `TypeError` à l'indexation.
  const hooksMap = isRecord(content) && isRecord(content.hooks)
    ? content.hooks as Record<string, CopilotHookEntry[]>
    : undefined;
  const rows = eventsFor('copilot').map(ev => {
    const entries = (hooksMap && hooksMap[ev]) || [];
    let installed = false, stale = false, others = 0;
    for (const e of entries) {
      const c = copilotEntryCommand(e);
      if (isAgentVizCommand(c)) {
        installed = true;
        if (c !== cmd.command) stale = true;
        if (e.timeoutSec !== HOOK_TIMEOUT_SEC) stale = true;
      } else {
        others++;
      }
    }
    return { event: ev, installed, stale, others };
  });
  return { ...target, audit: rows, command: cmd };
}

function installCopilot({ scope, cwd, packageRoot, version }: AgentOpts = {}) {
  const target = resolveScope({ scope, cwd, agent: 'copilot', packageRoot });
  const cmd = resolveHookCommand({ packageRoot, version, agent: 'copilot' });
  const desired = buildCopilotHookFile(cmd.command);
  const existing = readCopilotFile(target.file);

  let action = 'noop';
  let missing: string[] = [];
  let updated: string[] = [];
  let present: string[] = [];
  const coexisting: Record<string, number> = {};

  if (!existing) {
    action = 'installed';
    missing = [...eventsFor('copilot')];
  } else if (!isAgentVizCopilotFile(existing)) {
    // File exists under our name but isn't ours — refuse to overwrite.
    throw new Error(`refusing to overwrite ${target.file}: not an agent-viz hooks file`);
  } else {
    for (const ev of eventsFor('copilot')) {
      const arr = (existing.hooks && existing.hooks[ev]) || [];
      const ours = arr.find(e => isAgentVizCommand(copilotEntryCommand(e)));
      const others = arr.filter(e => e !== ours).length;
      if (others > 0) coexisting[ev] = others;
      if (!ours) missing.push(ev);
      else if (copilotEntryCommand(ours) !== cmd.command) updated.push(ev);
      else if (ours.timeoutSec !== HOOK_TIMEOUT_SEC) updated.push(ev);
      else present.push(ev);
    }
    if (missing.length === 0 && updated.length === 0) {
      const crossScope = findInstalledScopes({ cwd, packageRoot, agent: 'copilot' })
        .filter(s => s.scope !== target.scope);
      return { target, action: 'noop', missing, updated, present, coexisting, command: cmd, crossScope };
    }
    action = (missing.length && updated.length) ? 'installed+updated'
           : missing.length ? 'installed' : 'updated';
  }

  fs.mkdirSync(path.dirname(target.file), { recursive: true });
  fs.writeFileSync(target.file, JSON.stringify(desired, null, 2) + '\n');

  let gitignore: { changed: boolean; reason?: string } | null = null;
  if (target.scope === 'local' && target.projectRoot) {
    gitignore = ensureGitignore(target.projectRoot, AGENT_CONFIG.copilot.gitignoreEntry, GITIGNORE_EXTRAS.copilot);
  }

  const crossScope = findInstalledScopes({ cwd, packageRoot, agent: 'copilot' })
    .filter(s => s.scope !== target.scope);

  return { target, action, missing, updated, present, coexisting, command: cmd, gitignore, crossScope };
}

// All scopes the agent uses, in sweep order. Used by uninstall for "no scope"
// (clean everywhere) mode.
function copilotSweepTargets(cwd: string | undefined, { packageRoot }: { packageRoot?: string } = {}): ResolvedTarget[] {
  const out: ResolvedTarget[] = [{ scope: 'user', file: AGENT_CONFIG.copilot.userFile(), projectRoot: null }];
  const projectRoot = findProjectRoot(cwd || process.cwd(), { packageRoot });
  if (projectRoot) {
    out.push({ scope: 'project', file: AGENT_CONFIG.copilot.projectFile(projectRoot), projectRoot });
    out.push({ scope: 'local', file: AGENT_CONFIG.copilot.localFile(projectRoot), projectRoot });
  }
  return out;
}

function uninstallCopilot({ scope, cwd, packageRoot }: AgentOpts = {}) {
  const targets = scope
    ? [resolveScope({ scope, cwd, agent: 'copilot', packageRoot })]
    : copilotSweepTargets(cwd, { packageRoot });
  const results: Array<ResolvedTarget & { removed: number; exists: boolean }> = [];
  for (const t of targets) {
    if (!fs.existsSync(t.file)) {
      results.push({ ...t, removed: 0, exists: false });
      continue;
    }
    const content = readCopilotFile(t.file);
    if (isAgentVizCopilotFile(content)) {
      try { fs.unlinkSync(t.file); } catch {}
      results.push({ ...t, removed: eventsFor('copilot').length, exists: true });
    } else {
      results.push({ ...t, removed: 0, exists: true });
    }
  }
  return { results };
}

// ── High-level API ──

function auditClaude({ scope, cwd, packageRoot, version }: AgentOpts = {}) {
  const target = resolveScope({ scope, cwd, packageRoot });
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
function installClaude({ scope, cwd, packageRoot, version }: AgentOpts = {}) {
  const target = resolveScope({ scope, cwd, packageRoot });
  const settings = readSettings(target.file);
  const cmd = resolveHookCommand({ packageRoot, version });

  const missing: string[] = [];
  const updated: string[] = [];
  const present: string[] = [];
  const coexisting: Record<string, number> = {};
  for (const ev of EVENTS) {
    const info = inspectEvent(settings, ev, cmd.command);
    if (info.others > 0) coexisting[ev] = info.others;
    if (!info.present) missing.push(ev);
    else if (info.stale) updated.push(ev);
    else present.push(ev);
  }

  if (missing.length === 0 && updated.length === 0) {
    const crossScope = findInstalledScopes({ cwd, packageRoot, agent: 'claude' })
      .filter(s => s.scope !== target.scope);
    return { target, action: 'noop', missing, updated, present, coexisting, command: cmd, crossScope };
  }

  for (const ev of updated) refreshStaleCommand(settings, ev, cmd.command);
  for (const ev of missing) addHook(settings, ev, cmd.command);
  writeSettings(target.file, settings);

  let gitignore: { changed: boolean; reason?: string } | null = null;
  if (target.scope === 'local' && target.projectRoot) {
    gitignore = ensureGitignore(target.projectRoot, AGENT_CONFIG.claude.gitignoreEntry, GITIGNORE_EXTRAS.claude);
  }

  let action: string;
  if (missing.length > 0 && updated.length > 0) action = 'installed+updated';
  else if (missing.length > 0) action = 'installed';
  else action = 'updated';

  const crossScope = findInstalledScopes({ cwd, packageRoot, agent: 'claude' })
    .filter(s => s.scope !== target.scope);

  return { target, action, missing, updated, present, coexisting, command: cmd, gitignore, crossScope };
}

function claudeSweepTargets(cwd: string | undefined, { packageRoot }: { packageRoot?: string } = {}): ResolvedTarget[] {
  const out: ResolvedTarget[] = [{ scope: 'user', file: AGENT_CONFIG.claude.userFile(), projectRoot: null }];
  const projectRoot = findProjectRoot(cwd || process.cwd(), { packageRoot });
  if (projectRoot) {
    out.push({ scope: 'project', file: AGENT_CONFIG.claude.projectFile(projectRoot), projectRoot });
    out.push({ scope: 'local', file: AGENT_CONFIG.claude.localFile(projectRoot), projectRoot });
  }
  return out;
}

function uninstallClaude({ scope, cwd, packageRoot }: AgentOpts = {}) {
  const targets = scope
    ? [resolveScope({ scope, cwd, packageRoot })]
    : claudeSweepTargets(cwd, { packageRoot });
  const results: Array<ResolvedTarget & { removed: number; exists: boolean }> = [];
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

// Scan every scope (user + project + local) for the given agent and report
// which ones currently carry an agent-viz hook. Used to detect cross-scope
// duplicates: Claude Code merges hooks across scopes, so the same event fires
// N times if registered in N scopes. Callers use this to warn before adding a
// scope where the hook already exists elsewhere, and to surface where hooks
// live in `agent-viz status`.
//
// Adding a 3rd agent: extend the branch below alongside the AGENT_CONFIG /
// INSTALLERS entries — keep the per-agent "file is ours" recognizer (e.g.
// isAgentVizCopilotFile) in step with sweep-target discovery here.
function findInstalledScopes(
  { cwd, packageRoot, agent = 'claude' }: AgentOpts = {},
): Array<{ scope: Scope; file: string }> {
  const targets = agent === 'claude'
    ? claudeSweepTargets(cwd, { packageRoot })
    : copilotSweepTargets(cwd, { packageRoot });
  const installed: Array<{ scope: Scope; file: string }> = [];
  for (const t of targets) {
    if (!fs.existsSync(t.file)) continue;
    let hasHook = false;
    if (agent === 'claude') {
      const settings = readSettings(t.file);
      hasHook = EVENTS.some(ev => hasHookForEvent(settings, ev));
    } else {
      const content = readCopilotFile(t.file);
      hasHook = isAgentVizCopilotFile(content);
    }
    if (hasHook) installed.push({ scope: t.scope, file: t.file });
  }
  return installed;
}

// ── Registry + multi-agent dispatchers (public API) ──
//
// Each entry implements the same { install, uninstall, audit } shape and is
// detected via its `detect` predicate. To add a 3rd agent: implement those 4
// functions and register here. Dispatchers don't need to change.
//
// `target`: agent name | 'all' | 'both' (alias) | undefined.
// undefined → auto-detect; uninstall defaults to ALL agents (don't leave hooks
// behind if an agent got removed from PATH after install).
// Returns { <agent>: result, ... } where each side carries the per-agent result.

interface AgentInstaller {
  install: (opts: AgentOpts) => unknown;
  uninstall: (opts: AgentOpts) => unknown;
  audit: (opts: AgentOpts) => unknown;
  detect: () => boolean;
}

const INSTALLERS: Record<AgentName, AgentInstaller> = {
  claude: {
    install: installClaude,
    uninstall: uninstallClaude,
    audit: auditClaude,
    detect: () => agentDetected('claude'),
  },
  copilot: {
    install: installCopilot,
    uninstall: uninstallCopilot,
    audit: auditCopilot,
    detect: () => agentDetected('copilot'),
  },
};

function agentDetected(agent: string): boolean {
  const home = os.homedir();
  if (agent === 'claude') {
    return inPath('claude') || fs.existsSync(path.join(home, '.claude', 'settings.json'));
  }
  if (agent === 'copilot') {
    return inPath('copilot') || dirHasFiles(path.join(home, '.copilot'));
  }
  return false;
}

function dirHasFiles(p: string): boolean {
  try { return fs.readdirSync(p).length > 0; } catch { return false; }
}

function inPath(name: string): boolean {
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

// Une clef réelle du registre — vit ici, à côté de la constante qu'elle
// protège, plutôt qu'un cast : `Object.hasOwn` seul ne rétrécit pas `target`
// vers `AgentName` (même geste que transcript-adapters/index.ts, scellé).
function isAgentName(v: string): v is AgentName {
  return Object.hasOwn(INSTALLERS, v);
}

// Pick which agents to act on. `target` accepts a registered agent name, 'all'
// (or legacy 'both'), or undefined → auto-detect (fallback: first registered).
function pickAgents({ target }: { target?: string }): AgentName[] {
  const all = Object.keys(INSTALLERS) as AgentName[];
  if (target === 'all' || target === 'both') return all;
  if (target && isAgentName(target)) return [target];
  const detected = all.filter(a => INSTALLERS[a].detect());
  // `all` porte toujours 'claude' et 'copilot' (registre fixe ci-dessus) :
  // `all[0]` existe forcément, le `!` documente cet invariant.
  return detected.length > 0 ? detected : [all[0]!];
}

function dispatch(method: 'install' | 'uninstall' | 'audit', opts: AgentOpts): Record<string, unknown> {
  const agents = pickAgents(opts);
  const out: Record<string, unknown> = {};
  for (const a of agents) out[a] = INSTALLERS[a][method](opts);
  return out;
}

function install(opts: AgentOpts = {}): Record<string, unknown>   { return dispatch('install', opts); }
function audit(opts: AgentOpts = {}): Record<string, unknown>     { return dispatch('audit', opts); }
function uninstall(opts: AgentOpts = {}): Record<string, unknown> {
  // Default to ALL registered agents (sweep), even if not currently detected.
  const agents: AgentName[] = opts.target ? pickAgents(opts) : (Object.keys(INSTALLERS) as AgentName[]);
  const out: Record<string, unknown> = {};
  for (const a of agents) out[a] = INSTALLERS[a].uninstall(opts);
  return out;
}

// Back-compat: detectAgents() returns { claude: bool, copilot: bool, ... }
function detectAgents(_opts: AgentOpts = {}): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const a of Object.keys(INSTALLERS) as AgentName[]) out[a] = INSTALLERS[a].detect();
  return out;
}

// Multi-agent: { claude: [{scope,file},...], copilot: [...] } across user +
// project + local. Used by `agent-viz status` and the install-hooks
// cross-scope warning.
function installedScopes(
  { cwd, packageRoot }: { cwd?: string; packageRoot?: string } = {},
): Record<string, Array<{ scope: Scope; file: string }>> {
  const out: Record<string, Array<{ scope: Scope; file: string }>> = {};
  for (const a of Object.keys(INSTALLERS) as AgentName[]) {
    out[a] = findInstalledScopes({ cwd, packageRoot, agent: a });
  }
  return out;
}

const _internals = {
  readSettings, writeSettings, auditSettings, addHook, removeHook,
  hasHookForEvent, inspectEvent, refreshStaleCommand, eventsFor,
};

export {
  EVENTS,
  isAgentVizHook,
  isStandardShape,
  detectAgents,
  install,
  uninstall,
  audit,
  installedScopes,
  findInstalledScopes,
  resolveScope,
  resolveHookCommand,
  findProjectRoot,
  ensureGitignore,
  _internals,
};

// ── CLI standalone (kept for backwards compatibility) ──

// Ce que la CLI attend de `audit()`/`uninstall()`/`install()` — les mêmes
// registres que `dispatch` construit réellement (voir `AgentInstaller`
// ci-dessus), nommés ici pour l'affichage plutôt que laissés `unknown` :
// c'est la frontière propre à CE consommateur, pas une nouvelle promesse des
// fonctions haut niveau (qui restent `Record<string, unknown>`).
interface CliAuditResult {
  file: string;
  scope: Scope;
  audit: Array<{ event: string; installed: boolean; stale: boolean; others: number }>;
}
interface CliUninstallResult {
  results: Array<{ file: string; scope: Scope; removed: number; exists: boolean }>;
}
interface CliInstallResult {
  target: { file: string; scope: Scope };
  command: { command: string; mode: string };
  action: string;
  missing: string[];
  updated: string[];
  error?: string;
}

interface CliArgs {
  mode: 'install' | 'check' | 'uninstall';
  scope: Scope | undefined;
}

function parseCliArgs(argv: string[]): CliArgs {
  const out: CliArgs = { mode: 'install', scope: undefined };
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

function cliMain(argv: string[]): void {
  const { mode, scope } = parseCliArgs(argv);
  const cwd = process.cwd();

  if (mode === 'check') {
    const result = audit({ scope, cwd }) as Record<string, CliAuditResult>;
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
    const result = uninstall({ scope, cwd }) as Record<string, CliUninstallResult>;
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
  const result = install({ scope, cwd }) as { claude?: CliInstallResult; copilot?: CliInstallResult };
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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { cliMain(process.argv.slice(2)); }
  catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('Erreur :', message);
    process.exit(2);
  }
}

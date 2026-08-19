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

import { fileURLToPath } from 'node:url';

import type { AgentName, Scope, AgentOpts, AgentInstaller } from './install-hooks/types.ts';
import { EVENTS, eventsFor } from './install-hooks/config.ts';
import {
  isAgentVizHook, isStandardShape, readSettings, writeSettings, addHook,
  removeHook, hasHookForEvent, inspectEvent, refreshStaleCommand,
  type ClaudeSettings,
} from './install-hooks/settings-io.ts';
import { resolveScope, resolveHookCommand, findProjectRoot, ensureGitignore, scanInstalled } from './install-hooks/scopes.ts';
import { auditSettings, claudeInstaller } from './install-hooks/claude.ts';
import { copilotInstaller } from './install-hooks/copilot.ts';

// Scan every scope (user + project + local) for the given agent and report
// which ones currently carry an agent-viz hook. Used to detect cross-scope
// duplicates: Claude Code merges hooks across scopes, so the same event fires
// N times if registered in N scopes. Callers use this to warn before adding a
// scope where the hook already exists elsewhere, and to surface where hooks
// live in `agent-viz status`.
//
// Generique : le registre fournit sweepTargets et installedIn — plus aucun
// branchement par nom d'agent ici.
function findInstalledScopes(
  { cwd, packageRoot, agent = 'claude' }: AgentOpts = {},
): Array<{ scope: Scope; file: string }> {
  const inst = INSTALLERS[agent];
  return scanInstalled(inst.sweepTargets(cwd, { packageRoot }), inst.installedIn);
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

const INSTALLERS: Record<AgentName, AgentInstaller> = {
  claude: claudeInstaller,
  copilot: copilotInstaller,
};

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

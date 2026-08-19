// ── Registry + multi-agent dispatchers (public API) ──
//
// Each entry implements the AgentInstaller contract (types.ts) and is detected
// via its `detect` predicate. To add a 3rd agent: implement the contract in a
// new adapter file, add its AGENT_CONFIG entry, and register here. Dispatchers
// don't need to change.
//
// `target`: agent name | 'all' | 'both' (alias) | undefined.
// undefined → auto-detect; uninstall defaults to ALL agents (don't leave hooks
// behind if an agent got removed from PATH after install).
// Returns { <agent>: result, ... } where each side carries the per-agent result.
import type { AgentName, AgentOpts, Scope, AgentInstaller } from './types.ts';
import { scanInstalled } from './scopes.ts';
import { claudeInstaller } from './claude.ts';
import { copilotInstaller } from './copilot.ts';

export const INSTALLERS: Record<AgentName, AgentInstaller> = {
  claude: claudeInstaller,
  copilot: copilotInstaller,
};

// Une clef réelle du registre — vit ici, à côté de la constante qu'elle
// protège, plutôt qu'un cast : `Object.hasOwn` seul ne rétrécit pas `target`
// vers `AgentName` (même geste que transcript-adapters/index.ts, scellé).
export function isAgentName(v: string): v is AgentName {
  return Object.hasOwn(INSTALLERS, v);
}

// Pick which agents to act on. `target` accepts a registered agent name, 'all'
// (or legacy 'both'), or undefined → auto-detect (fallback: first registered).
export function pickAgents({ target }: { target?: string }): AgentName[] {
  const all = Object.keys(INSTALLERS) as AgentName[];
  if (target === 'all' || target === 'both') return all;
  if (target && isAgentName(target)) return [target];
  const detected = all.filter(a => INSTALLERS[a].detect());
  // `all` porte toujours 'claude' et 'copilot' (registre fixe ci-dessus) :
  // `all[0]` existe forcément, le `!` documente cet invariant.
  return detected.length > 0 ? detected : [all[0]!];
}

export function dispatch(method: 'install' | 'uninstall' | 'audit', opts: AgentOpts): Record<string, unknown> {
  const agents = pickAgents(opts);
  const out: Record<string, unknown> = {};
  for (const a of agents) out[a] = INSTALLERS[a][method](opts);
  return out;
}

export function install(opts: AgentOpts = {}): Record<string, unknown>   { return dispatch('install', opts); }
export function audit(opts: AgentOpts = {}): Record<string, unknown>     { return dispatch('audit', opts); }
export function uninstall(opts: AgentOpts = {}): Record<string, unknown> {
  // Default to ALL registered agents (sweep), even if not currently detected.
  const agents: AgentName[] = opts.target ? pickAgents(opts) : (Object.keys(INSTALLERS) as AgentName[]);
  const out: Record<string, unknown> = {};
  for (const a of agents) out[a] = INSTALLERS[a].uninstall(opts);
  return out;
}

// Back-compat: detectAgents() returns { claude: bool, copilot: bool, ... }
export function detectAgents(_opts: AgentOpts = {}): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const a of Object.keys(INSTALLERS) as AgentName[]) out[a] = INSTALLERS[a].detect();
  return out;
}

// Scan every scope (user + project + local) for the given agent and report
// which ones currently carry an agent-viz hook. Used to detect cross-scope
// duplicates: Claude Code merges hooks across scopes, so the same event fires
// N times if registered in N scopes. Callers use this to warn before adding a
// scope where the hook already exists elsewhere, and to surface where hooks
// live in `agent-viz status`.
//
// Generique : le registre fournit sweepTargets et installedIn — plus aucun
// branchement par nom d'agent ici.
export function findInstalledScopes(
  { cwd, packageRoot, agent = 'claude' }: AgentOpts = {},
): Array<{ scope: Scope; file: string }> {
  const inst = INSTALLERS[agent];
  return scanInstalled(inst.sweepTargets(cwd, { packageRoot }), inst.installedIn);
}

// Multi-agent: { claude: [{scope,file},...], copilot: [...] } across user +
// project + local. Used by `agent-viz status` and the install-hooks
// cross-scope warning.
export function installedScopes(
  { cwd, packageRoot }: { cwd?: string; packageRoot?: string } = {},
): Record<string, Array<{ scope: Scope; file: string }>> {
  const out: Record<string, Array<{ scope: Scope; file: string }>> = {};
  for (const a of Object.keys(INSTALLERS) as AgentName[]) {
    out[a] = findInstalledScopes({ cwd, packageRoot, agent: a });
  }
  return out;
}

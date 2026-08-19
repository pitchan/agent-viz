// L'adaptateur Claude Code : audit / install / uninstall des crochets dans
// settings.json, balayage des portées, détection de l'agent sur la machine.
// Implémente le contrat AgentInstaller — le registre (registry.ts) n'a besoin
// de rien savoir de plus.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { AgentOpts, ResolvedTarget, AgentInstaller } from './types.ts';
import { AGENT_CONFIG, GITIGNORE_EXTRAS, EVENTS } from './config.ts';
import {
  readSettings, writeSettings, inspectEvent, refreshStaleCommand, addHook,
  removeHook, hasHookForEvent,
  type ClaudeSettings,
} from './settings-io.ts';
import { resolveScope, resolveHookCommand, ensureGitignore, findProjectRoot, scanInstalled } from './scopes.ts';
import { inPath } from './detect.ts';

export function auditSettings(
  settings: ClaudeSettings, desiredCommand: string | undefined,
): Array<{ event: string; installed: boolean; stale: boolean; others: number }> {
  return EVENTS.map(ev => {
    const info = inspectEvent(settings, ev, desiredCommand);
    return { event: ev, installed: info.present, stale: info.stale, others: info.others };
  });
}

export function auditClaude({ scope, cwd, packageRoot, version }: AgentOpts = {}) {
  const target = resolveScope({ scope, cwd, packageRoot });
  const settings = readSettings(target.file);
  const cmd = resolveHookCommand({ packageRoot, version });
  return { ...target, audit: auditSettings(settings, cmd.command), command: cmd };
}

// « Ce fichier porte notre crochet » — extrait de l'ancien findInstalledScopes.
function claudeHookIn(file: string): boolean {
  const settings = readSettings(file);
  return EVENTS.some(ev => hasHookForEvent(settings, ev));
}

// Le balayage LOCAL des portées de cet agent (crossScope) : l'adaptateur se
// connaît lui-même, seul le registre agrège plusieurs agents.
function claudeInstalledScopes(cwd?: string, packageRoot?: string) {
  return scanInstalled(claudeSweepTargets(cwd, { packageRoot }), claudeHookIn);
}

// Install / refresh agent-viz hooks. Returns:
//   action: 'noop' | 'installed' | 'updated' | 'installed+updated'
//   missing:    events where no agent-viz hook existed (now added)
//   updated:    events where a stale standard-shape command was rewritten
//   present:    events where an up-to-date agent-viz hook was already there
//   coexisting: { event: count } — non-agent-viz hooks sharing the same events
//                (informational; they will run in parallel, we never touch them)
export function installClaude({ scope, cwd, packageRoot, version }: AgentOpts = {}) {
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
    const crossScope = claudeInstalledScopes(cwd, packageRoot)
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

  const crossScope = claudeInstalledScopes(cwd, packageRoot)
    .filter(s => s.scope !== target.scope);

  return { target, action, missing, updated, present, coexisting, command: cmd, gitignore, crossScope };
}

export function claudeSweepTargets(cwd: string | undefined, { packageRoot }: { packageRoot?: string } = {}): ResolvedTarget[] {
  const out: ResolvedTarget[] = [{ scope: 'user', file: AGENT_CONFIG.claude.userFile(), projectRoot: null }];
  const projectRoot = findProjectRoot(cwd || process.cwd(), { packageRoot });
  if (projectRoot) {
    out.push({ scope: 'project', file: AGENT_CONFIG.claude.projectFile(projectRoot), projectRoot });
    out.push({ scope: 'local', file: AGENT_CONFIG.claude.localFile(projectRoot), projectRoot });
  }
  return out;
}

export function uninstallClaude({ scope, cwd, packageRoot }: AgentOpts = {}) {
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

export const claudeInstaller: AgentInstaller = {
  install: installClaude,
  uninstall: uninstallClaude,
  audit: auditClaude,
  // Extrait de l'ancien agentDetected('claude').
  detect: () => inPath('claude') || fs.existsSync(path.join(os.homedir(), '.claude', 'settings.json')),
  sweepTargets: claudeSweepTargets,
  installedIn: claudeHookIn,
};

// L'installateur des agents dont le fichier de hooks a la forme du settings.json de
// Claude Code : `hooks → événement → [{ hooks: [{ type, command, timeout }] }]`.
// L'agent donne son nom ; chemins et événements viennent d'AGENT_CONFIG.
import fs from 'node:fs';
import type { AgentName, AgentOpts, AgentConfigEntry, AgentInstaller, ResolvedTarget } from './types.ts';
import { AGENT_CONFIG, GITIGNORE_EXTRAS } from './config.ts';
import {
  readSettings, writeSettings, inspectEvent, refreshStaleCommand, addHook,
  removeHook, hasHookForEvent,
  type ClaudeSettings,
} from './settings-io.ts';
import { resolveScope, resolveHookCommand, ensureGitignore, findProjectRoot, scanInstalled } from './scopes.ts';
import { backupHookFile } from './backup.ts';

export function auditEvents(
  settings: ClaudeSettings, events: string[], desiredCommand: string | undefined,
): Array<{ event: string; installed: boolean; stale: boolean; others: number }> {
  return events.map(ev => {
    const info = inspectEvent(settings, ev, desiredCommand);
    return { event: ev, installed: info.present, stale: info.stale, others: info.others };
  });
}

// Les seuls agents dont le fichier de hooks a cette forme : Copilot et Antigravity écrivent la leur.
export type SettingsShapeAgent = Extract<AgentName, 'claude' | 'codex'>;

export function settingsInstaller(agent: SettingsShapeAgent): Omit<AgentInstaller, 'detect'> {
  const cfg: AgentConfigEntry = AGENT_CONFIG[agent];
  const events = cfg.events;

  function hookIn(file: string): boolean {
    const settings = readSettings(file);
    return events.some(ev => hasHookForEvent(settings, ev));
  }

  function sweepTargets(cwd: string | undefined, { packageRoot }: { packageRoot?: string } = {}): ResolvedTarget[] {
    const out: ResolvedTarget[] = [{ scope: 'user', file: cfg.userFile(), projectRoot: null }];
    const projectRoot = findProjectRoot(cwd || process.cwd(), { packageRoot });
    if (projectRoot) {
      out.push({ scope: 'project', file: cfg.projectFile(projectRoot), projectRoot });
      if (cfg.localFile) out.push({ scope: 'local', file: cfg.localFile(projectRoot), projectRoot });
    }
    return out;
  }

  // `.installed` seul : l'avertissement inter-portées ne parle que des portées qui portent
  // notre hook. Un fichier illisible remonte par `audit`, dont c'est le métier.
  function otherScopes(current: ResolvedTarget, cwd?: string, packageRoot?: string) {
    return scanInstalled(sweepTargets(cwd, { packageRoot }), hookIn).installed
      .filter(s => s.scope !== current.scope);
  }

  function audit({ scope, cwd, packageRoot }: AgentOpts = {}) {
    const target = resolveScope({ scope, cwd, packageRoot, agent });
    const settings = readSettings(target.file);
    const cmd = resolveHookCommand({ packageRoot, agent });
    return { ...target, audit: auditEvents(settings, events, cmd.command), command: cmd };
  }

  // action: 'noop' | 'installed' | 'updated' | 'installed+updated'
  // coexisting: { event: count } — les hooks d'un tiers sur les mêmes événements, jamais touchés.
  function install({ scope, cwd, packageRoot }: AgentOpts = {}) {
    const target = resolveScope({ scope, cwd, packageRoot, agent });
    const settings = readSettings(target.file);
    const cmd = resolveHookCommand({ packageRoot, agent });

    const missing: string[] = [];
    const updated: string[] = [];
    const present: string[] = [];
    const coexisting: Record<string, number> = {};
    for (const ev of events) {
      const info = inspectEvent(settings, ev, cmd.command);
      if (info.others > 0) coexisting[ev] = info.others;
      if (!info.present) missing.push(ev);
      else if (info.stale) updated.push(ev);
      else present.push(ev);
    }

    if (missing.length === 0 && updated.length === 0) {
      const crossScope = otherScopes(target, cwd, packageRoot);
      return { target, action: 'noop', missing, updated, present, coexisting, command: cmd, backup: null, crossScope };
    }

    for (const ev of updated) refreshStaleCommand(settings, ev, cmd.command);
    for (const ev of missing) addHook(settings, ev, cmd.command);
    const backup = backupHookFile(target.file);
    writeSettings(target.file, settings);

    let gitignore: ReturnType<typeof ensureGitignore> | null = null;
    if (target.scope === 'local' && target.projectRoot && cfg.gitignoreEntry) {
      gitignore = ensureGitignore(target.projectRoot, cfg.gitignoreEntry, GITIGNORE_EXTRAS[agent]);
    }

    let action: string;
    if (missing.length > 0 && updated.length > 0) action = 'installed+updated';
    else if (missing.length > 0) action = 'installed';
    else action = 'updated';

    const crossScope = otherScopes(target, cwd, packageRoot);
    return { target, action, missing, updated, present, coexisting, command: cmd, backup, gitignore, crossScope };
  }

  function uninstall({ scope, cwd, packageRoot }: AgentOpts = {}) {
    const targets = scope
      ? [resolveScope({ scope, cwd, packageRoot, agent })]
      : sweepTargets(cwd, { packageRoot });
    const results: Array<ResolvedTarget & { removed: number; exists: boolean; backup: string | null }> = [];
    for (const t of targets) {
      if (!fs.existsSync(t.file)) {
        results.push({ ...t, removed: 0, exists: false, backup: null });
        continue;
      }
      const settings = readSettings(t.file);
      let total = 0;
      for (const ev of events) total += removeHook(settings, ev);
      let backup: string | null = null;
      if (total > 0) {
        backup = backupHookFile(t.file);
        writeSettings(t.file, settings);
      }
      results.push({ ...t, removed: total, exists: true, backup });
    }
    return { results };
  }

  return { install, uninstall, audit, sweepTargets, installedIn: hookIn };
}

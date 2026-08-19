// L'adaptateur GitHub Copilot CLI : audit / install / uninstall du fichier de
// crochets agent-viz.json, balayage des portées, détection de l'agent.
// Implémente le contrat AgentInstaller. Le fichier de hooks Copilot n'est typé
// que sur ce que ce module lit/écrit réellement — une index signature ouverte
// tolère le reste.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { AgentOpts, ResolvedTarget, AgentInstaller } from './types.ts';
import { HOOK_TIMEOUT_SEC } from './types.ts';
import { AGENT_CONFIG, GITIGNORE_EXTRAS, eventsFor } from './config.ts';
import { resolveScope, resolveHookCommand, ensureGitignore, findProjectRoot, scanInstalled } from './scopes.ts';
import { inPath, dirHasFiles } from './detect.ts';

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

// « Ce fichier porte notre crochet » — extrait de l'ancien findInstalledScopes.
function copilotHookIn(file: string): boolean {
  return isAgentVizCopilotFile(readCopilotFile(file));
}

// Le balayage LOCAL des portées de cet agent (crossScope) : l'adaptateur se
// connaît lui-même, seul le registre agrège plusieurs agents.
function copilotInstalledScopes(cwd?: string, packageRoot?: string) {
  return scanInstalled(copilotSweepTargets(cwd, { packageRoot }), copilotHookIn);
}

export function auditCopilot({ scope, cwd, packageRoot, version }: AgentOpts = {}) {
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

export function installCopilot({ scope, cwd, packageRoot, version }: AgentOpts = {}) {
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
      const crossScope = copilotInstalledScopes(cwd, packageRoot)
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

  const crossScope = copilotInstalledScopes(cwd, packageRoot)
    .filter(s => s.scope !== target.scope);

  return { target, action, missing, updated, present, coexisting, command: cmd, gitignore, crossScope };
}

// All scopes the agent uses, in sweep order. Used by uninstall for "no scope"
// (clean everywhere) mode.
export function copilotSweepTargets(cwd: string | undefined, { packageRoot }: { packageRoot?: string } = {}): ResolvedTarget[] {
  const out: ResolvedTarget[] = [{ scope: 'user', file: AGENT_CONFIG.copilot.userFile(), projectRoot: null }];
  const projectRoot = findProjectRoot(cwd || process.cwd(), { packageRoot });
  if (projectRoot) {
    out.push({ scope: 'project', file: AGENT_CONFIG.copilot.projectFile(projectRoot), projectRoot });
    out.push({ scope: 'local', file: AGENT_CONFIG.copilot.localFile(projectRoot), projectRoot });
  }
  return out;
}

export function uninstallCopilot({ scope, cwd, packageRoot }: AgentOpts = {}) {
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

export const copilotInstaller: AgentInstaller = {
  install: installCopilot,
  uninstall: uninstallCopilot,
  audit: auditCopilot,
  // Extrait de l'ancien agentDetected('copilot').
  detect: () => inPath('copilot') || dirHasFiles(path.join(os.homedir(), '.copilot')),
  sweepTargets: copilotSweepTargets,
  installedIn: copilotHookIn,
};

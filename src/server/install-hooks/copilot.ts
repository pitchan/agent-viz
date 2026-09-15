// L'adaptateur GitHub Copilot CLI : audit / install / uninstall du fichier de
// hooks agent-viz.json, balayage des portées, détection de l'agent.
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
import { writeJsonAtomic } from './atomic-write.ts';
import { backupHookFile } from './backup.ts';

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

// Fusion chirurgicale dans un fichier DÉJÀ reconnu comme nôtre — même
// postcondition que l'adaptateur Claude (`refreshStaleCommand` / `addHook`) :
// ce qui n'est pas à nous survit. Écraser par `buildCopilotHookFile` détruisait
// les entrées tierces que la CLI annonce pourtant « untouched ».
function mergeCopilotHooks(existing: CopilotHooksFile, command: string): CopilotHooksFile {
  const entry: CopilotHookEntry = { type: 'command', bash: command, powershell: command, timeoutSec: HOOK_TIMEOUT_SEC };
  const hooks: Record<string, CopilotHookEntry[]> = { ...existing.hooks };
  for (const ev of eventsFor('copilot')) {
    const arr = Array.isArray(hooks[ev]) ? [...hooks[ev]] : [];
    const i = arr.findIndex(e => isAgentVizCommand(copilotEntryCommand(e)));
    if (i >= 0) arr[i] = entry;
    else arr.push(entry);
    hooks[ev] = arr;
  }
  return { ...existing, version: 1, hooks };
}

// Retour `unknown`, PAS `CopilotHooksFile | null` : `JSON.parse` d'un fichier disque ne
// garantit rien de sa forme (un `agent-viz.json` valide sans clé `hooks` existe). Un type qui la
// promettrait ferait passer pour redondant le garde de chaque appelant, `auditCopilot` compris.
function readCopilotFile(file: string): unknown {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e: unknown) {
    if (e instanceof Error && 'code' in e && e.code === 'ENOENT') return null;
    const message = e instanceof Error ? e.message : String(e);
    throw new Error(`${file} invalid : ${message}`);
  }
}

// « Ce fichier est un fichier de hooks Copilot » — la FORME seule, sans rien exiger du contenu.
// C'est la question du refus d'écrasement : une forme étrangère est refusée, un fichier de hooks
// valide est fusionné, qu'il porte ou non notre entrée, comme `installClaude` avec un settings.json.
function isCopilotHooksFile(content: unknown): content is CopilotHooksFile {
  return isRecord(content) && content.version === 1 && isRecord(content.hooks);
}

// True if the file shape matches what buildCopilotHookFile produced AND any
// entry's command mentions agent-viz hook. Question STRICTEMENT plus forte que
// `isCopilotHooksFile` : elle répond « ce fichier porte-t-il NOTRE hook ? »,
// et c'est ce que `installedIn` doit continuer de signifier — `status` s'en
// sert pour dire OÙ les hooks vivent. Ne pas l'assouplir.
function isAgentVizCopilotFile(content: unknown): content is CopilotHooksFile {
  if (!isCopilotHooksFile(content)) return false;
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

// « Ce fichier porte notre hook » : le prédicat du balayage local des portées
// et de `installedIn`, que lit le registre.
function copilotHookIn(file: string): boolean {
  return isAgentVizCopilotFile(readCopilotFile(file));
}

// Le balayage LOCAL des portées de cet agent (crossScope) : l'adaptateur se
// connaît lui-même, seul le registre agrège plusieurs agents.
function copilotInstalledScopes(cwd?: string, packageRoot?: string) {
  return scanInstalled(copilotSweepTargets(cwd, { packageRoot }), copilotHookIn);
}

export function auditCopilot({ scope, cwd, packageRoot }: AgentOpts = {}) {
  const target = resolveScope({ scope, cwd, agent: 'copilot', packageRoot });
  const cmd = resolveHookCommand({ packageRoot, agent: 'copilot' });
  const content = readCopilotFile(target.file);
  // `content` est `unknown` (voir `readCopilotFile`) : un fichier JSON valide sans `hooks`
  // rend `hooksMap` `undefined` ici, jamais un `TypeError` à l'indexation.
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

export function installCopilot({ scope, cwd, packageRoot }: AgentOpts = {}) {
  const target = resolveScope({ scope, cwd, agent: 'copilot', packageRoot });
  const cmd = resolveHookCommand({ packageRoot, agent: 'copilot' });
  const desired = buildCopilotHookFile(cmd.command);
  const existing = readCopilotFile(target.file);

  // Ce qu'on écrira : le fichier neuf si rien n'existe, la fusion sinon.
  let content: CopilotHooksFile = desired;

  let action = 'noop';
  let missing: string[] = [];
  let updated: string[] = [];
  let present: string[] = [];
  const coexisting: Record<string, number> = {};

  if (!existing) {
    action = 'installed';
    missing = [...eventsFor('copilot')];
  } else if (!isCopilotHooksFile(existing)) {
    // Le fichier porte notre nom sans la FORME d'un fichier de hooks Copilot : refus d'écraser.
    // Le refus interroge la forme, PAS notre entrée : l'exiger bloquait pour de bon la réinstallation
    // dès qu'une entrée tierce gardait le fichier vidé du nôtre, soit dès un cycle stop / start.
    throw new Error(`refusing to overwrite ${target.file}: not an agent-viz hooks file`);
  } else {
    for (const ev of eventsFor('copilot')) {
      // Même garde que `mergeCopilotHooks` et `uninstallCopilot` : le type dit
      // `CopilotHookEntry[]`, le disque ne le garantit pas (cf.
      // `readCopilotFile`). Depuis que le refus interroge la FORME du fichier
      // et non la présence de notre entrée, un `hooks[ev]` non-tableau atteint
      // cette boucle au lieu d'être refusé en amont — sans ce garde il en
      // sortait « arr.find is not a function », une erreur qui ne nomme ni le
      // fichier ni le problème. `mergeCopilotHooks` écrit ensuite notre entrée
      // à cette clef, comme il le fait déjà pour toute valeur non-tableau.
      const brut = existing.hooks && existing.hooks[ev];
      const arr = Array.isArray(brut) ? brut : [];
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
      return { target, action: 'noop', missing, updated, present, coexisting, command: cmd, backup: null, crossScope };
    }
    content = mergeCopilotHooks(existing, cmd.command);
    action = (missing.length && updated.length) ? 'installed+updated'
           : missing.length ? 'installed' : 'updated';
  }

  const backup = backupHookFile(target.file);
  writeJsonAtomic(target.file, content);

  let gitignore: { changed: boolean; reason?: string } | null = null;
  if (target.scope === 'local' && target.projectRoot) {
    gitignore = ensureGitignore(target.projectRoot, AGENT_CONFIG.copilot.gitignoreEntry, GITIGNORE_EXTRAS.copilot);
  }

  const crossScope = copilotInstalledScopes(cwd, packageRoot)
    .filter(s => s.scope !== target.scope);

  return { target, action, missing, updated, present, coexisting, command: cmd, backup, gitignore, crossScope };
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
  const results: Array<ResolvedTarget & { removed: number; exists: boolean; backup: string | null }> = [];
  for (const t of targets) {
    if (!fs.existsSync(t.file)) {
      results.push({ ...t, removed: 0, exists: false, backup: null });
      continue;
    }
    const content = readCopilotFile(t.file);
    if (isAgentVizCopilotFile(content)) {
      // Compter ce qui est RÉELLEMENT à nous, événement par événement — et non
      // un forfait `eventsFor('copilot').length` qui annonçait 5 retraits même
      // quand le fichier n'en portait qu'un.
      let removed = 0;
      const kept: Record<string, CopilotHookEntry[]> = {};
      for (const [ev, arr] of Object.entries(content.hooks)) {
        // `isAgentVizCopilotFile` ne garantit que `isRecord(content.hooks)` :
        // une valeur non-tableau est un contenu disque possible, pas une
        // impossibilité — on la préserve telle quelle. (Le prédicat type `arr`
        // en `CopilotHookEntry[]`, donc TypeScript narrowe la branche fausse en
        // `never` : c'est le type qui ment, pas le garde qui est inutile — même
        // situation que le commentaire de `readCopilotFile`. Si le compilateur
        // proteste, caster `content.hooks as Record<string, unknown>` pour
        // l'itération plutôt que retirer le garde.)
        if (!Array.isArray(arr)) { kept[ev] = arr; continue; }
        const others = arr.filter(e => !isAgentVizCommand(copilotEntryCommand(e)));
        removed += arr.length - others.length;
        if (others.length > 0) kept[ev] = others;
      }
      const backup = backupHookFile(t.file);
      if (Object.keys(kept).length > 0) {
        // Des entrées tierces coexistent : retrait chirurgical, on ne supprime
        // pas le fichier qui les porte.
        writeJsonAtomic(t.file, { ...content, hooks: kept });
      } else {
        // Le fichier ne portait que nous : il s'en va. Pas de `catch {}` muet : un retrait qui
        // échoue lève, et le registre en fait un `{ error }` au lieu d'annoncer « removed ».
        fs.unlinkSync(t.file);
      }
      results.push({ ...t, removed, exists: true, backup });
    } else {
      results.push({ ...t, removed: 0, exists: true, backup: null });
    }
  }
  return { results };
}

export const copilotInstaller: AgentInstaller = {
  install: installCopilot,
  uninstall: uninstallCopilot,
  audit: auditCopilot,
  detect: () => inPath('copilot') || dirHasFiles(path.join(os.homedir(), '.copilot')),
  sweepTargets: copilotSweepTargets,
  installedIn: copilotHookIn,
};

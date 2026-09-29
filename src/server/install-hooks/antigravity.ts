// L'adaptateur Antigravity CLI (agy) : audit / install / uninstall de la clé
// « agent-viz » d'un hooks.json, balayage des portées, détection de l'agent.
// Implémente AgentInstaller ; les autres noms de hook du fichier ne sont jamais touchés.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { isDeepStrictEqual } from 'node:util';
import type { AgentOpts, ResolvedTarget, ResolvedCommand, AgentInstaller } from './types.ts';
import { HOOK_TIMEOUT_SEC } from './types.ts';
import { AGENT_CONFIG, eventsFor } from './config.ts';
import { resolveScope, resolveHookCommand, findProjectRoot, scanInstalled } from './scopes.ts';
import { inPath, dirHasFiles } from './detect.ts';
import { writeJsonAtomic } from './atomic-write.ts';
import { backupHookFile } from './backup.ts';

// Un hooks.json agy regroupe ses événements sous des noms de hook : celui-ci est le nôtre.
const OUR_KEY = 'agent-viz';
// agy attend un groupe {matcher, hooks} pour ces deux événements, une liste à plat pour
// les autres, et rejette TOUT le fichier si la forme ne correspond pas.
const TOOL_EVENTS = new Set(['PreToolUse', 'PostToolUse']);

interface Handler { type: string; command: string; timeout?: number }

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function isAgentVizCommand(cmd: unknown): boolean {
  return typeof cmd === 'string' && /agent-viz/.test(cmd) && /\bhook\b/.test(cmd);
}

// Sous Windows, agy transmet les guillemets tels quels à node, qui prend alors le chemin
// pour un chemin relatif : la commande s'écrit sans guillemets, un chemin à espace est refusé.
function antigravityCommand(packageRoot: string | undefined): ResolvedCommand {
  const cmd = resolveHookCommand({ packageRoot, agent: 'antigravity' });
  if (cmd.mode === 'npx') return cmd;
  // Le mode « absolute » porte toujours `path` (scopes.ts).
  const p = cmd.path!;
  if (p.includes(' ')) {
    throw new Error(`antigravity: agent-viz path contains a space, which agy hooks cannot run (install agent-viz under a path without spaces): ${p}`);
  }
  return { ...cmd, command: `node ${p} hook --source=antigravity` };
}

// La charge d'agy ne nomme pas son événement : chaque commande porte le sien.
function commandFor(base: string, event: string): string {
  return `${base} --event=${event}`;
}

function buildBlock(base: string): Record<string, unknown[]> {
  const block: Record<string, unknown[]> = {};
  for (const ev of eventsFor('antigravity')) {
    const h: Handler = { type: 'command', command: commandFor(base, ev), timeout: HOOK_TIMEOUT_SEC };
    block[ev] = TOOL_EVENTS.has(ev) ? [{ matcher: '*', hooks: [h] }] : [h];
  }
  return block;
}

// Les commandes d'un événement, qu'il soit en groupes {matcher, hooks} ou à plat.
function handlersOf(entries: unknown): Handler[] {
  if (!Array.isArray(entries)) return [];
  const out: Handler[] = [];
  for (const e of entries) {
    if (!isRecord(e)) continue;
    if (Array.isArray(e.hooks)) {
      for (const h of e.hooks) if (isRecord(h) && typeof h.command === 'string') out.push(h as unknown as Handler);
    } else if (typeof e.command === 'string') {
      out.push(e as unknown as Handler);
    }
  }
  return out;
}

// `unknown` : JSON.parse d'un fichier disque ne garantit rien de sa forme.
function readHooksFile(file: string): unknown {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e: unknown) {
    if (e instanceof Error && 'code' in e && e.code === 'ENOENT') return null;
    const message = e instanceof Error ? e.message : String(e);
    throw new Error(`${file} invalid : ${message}`);
  }
}

function hasOurHook(content: unknown): boolean {
  if (!isRecord(content) || !isRecord(content[OUR_KEY])) return false;
  return Object.values(content[OUR_KEY]).some(v => handlersOf(v).some(h => isAgentVizCommand(h.command)));
}

function auditRows(content: unknown, base: string) {
  const built = buildBlock(base);
  const ours = isRecord(content) && isRecord(content[OUR_KEY]) ? content[OUR_KEY] : {};
  return eventsFor('antigravity').map(ev => {
    const mine = handlersOf(ours[ev]).filter(h => isAgentVizCommand(h.command));
    const installed = mine.length > 0;
    // La forme compte autant que la commande : agy rejette TOUT le fichier si un
    // événement à enveloppe {matcher,hooks} est écrit à plat, ou l'inverse.
    const stale = installed && !isDeepStrictEqual(ours[ev], built[ev]);
    // `others` : le nombre de noms de hook DU FICHIER (hors le nôtre) qui abonnent aussi cet événement.
    const others = isRecord(content)
      ? Object.entries(content).filter(([k, v]) => k !== OUR_KEY && isRecord(v) && Array.isArray(v[ev])).length
      : 0;
    return { event: ev, installed, stale, others };
  });
}

export function antigravitySweepTargets(cwd: string | undefined, { packageRoot }: { packageRoot?: string } = {}): ResolvedTarget[] {
  const out: ResolvedTarget[] = [{ scope: 'user', file: AGENT_CONFIG.antigravity.userFile(), projectRoot: null }];
  const projectRoot = findProjectRoot(cwd || process.cwd(), { packageRoot });
  if (projectRoot) out.push({ scope: 'project', file: AGENT_CONFIG.antigravity.projectFile(projectRoot), projectRoot });
  return out;
}

function antigravityHookIn(file: string): boolean {
  return hasOurHook(readHooksFile(file));
}

export function auditAntigravity({ scope, cwd, packageRoot }: AgentOpts = {}) {
  const target = resolveScope({ scope, cwd, agent: 'antigravity', packageRoot });
  const cmd = antigravityCommand(packageRoot);
  return { ...target, audit: auditRows(readHooksFile(target.file), cmd.command), command: cmd };
}

export function installAntigravity({ scope, cwd, packageRoot }: AgentOpts = {}) {
  const target = resolveScope({ scope, cwd, agent: 'antigravity', packageRoot });
  const cmd = antigravityCommand(packageRoot);
  const existing = readHooksFile(target.file);
  if (existing !== null && !isRecord(existing)) {
    throw new Error(`refusing to overwrite ${target.file}: not a hooks.json object`);
  }
  const built = buildBlock(cmd.command);
  const rows = auditRows(existing, cmd.command);
  const missing = rows.filter(r => !r.installed).map(r => r.event);
  const updated = rows.filter(r => r.installed && r.stale).map(r => r.event);
  const present = rows.filter(r => r.installed && !r.stale).map(r => r.event);
  const coexisting = Object.fromEntries(rows.filter(r => r.others > 0).map(r => [r.event, r.others]));
  const crossScope = () => scanInstalled(antigravitySweepTargets(cwd, { packageRoot }), antigravityHookIn)
    .installed.filter(s => s.scope !== target.scope);

  // Gate au niveau du bloc entier, pas seulement des lignes par événement : une clé en
  // trop (ex. PreInvocation) n'a pas de ligne dans `rows` (qui ne connaît que les
  // événements déclarés), mais rend déjà `existingBlock` inégal à `built` — un seul
  // `isDeepStrictEqual` couvre ce cas sans garde séparée sur les clés en trop.
  const existingBlock = isRecord(existing) && isRecord(existing[OUR_KEY]) ? existing[OUR_KEY] : null;
  const blockUpToDate = existingBlock !== null && isDeepStrictEqual(existingBlock, built);

  if (missing.length === 0 && updated.length === 0 && blockUpToDate) {
    return { target, action: 'noop', missing, updated, present, coexisting, command: cmd, backup: null, crossScope: crossScope() };
  }
  const action = (missing.length && updated.length) ? 'installed+updated' : missing.length ? 'installed' : 'updated';
  const backup = backupHookFile(target.file);
  writeJsonAtomic(target.file, { ...(existing ?? {}), [OUR_KEY]: built });
  return { target, action, missing, updated, present, coexisting, command: cmd, backup, gitignore: null, crossScope: crossScope() };
}

export function uninstallAntigravity({ scope, cwd, packageRoot }: AgentOpts = {}) {
  const targets = scope
    ? [resolveScope({ scope, cwd, agent: 'antigravity', packageRoot })]
    : antigravitySweepTargets(cwd, { packageRoot });
  const results: Array<ResolvedTarget & { removed: number; exists: boolean; backup: string | null }> = [];
  for (const t of targets) {
    if (!fs.existsSync(t.file)) { results.push({ ...t, removed: 0, exists: false, backup: null }); continue; }
    const content = readHooksFile(t.file);
    if (!hasOurHook(content)) {
      results.push({ ...t, removed: 0, exists: true, backup: null });
      continue;
    }
    // `hasOurHook` vient de garantir `isRecord(content) && isRecord(content[OUR_KEY])`.
    const ourBlock = (content as Record<string, unknown>)[OUR_KEY] as Record<string, unknown>;
    const removed = Object.values(ourBlock)
      .flatMap(v => handlersOf(v))
      .filter(h => isAgentVizCommand(h.command)).length;
    const backup = backupHookFile(t.file);
    const rest: Record<string, unknown> = { ...(content as Record<string, unknown>) };
    delete rest[OUR_KEY];
    // Pas de `catch {}` muet : un retrait qui échoue lève, et le registre en fait un `{ error }`.
    if (Object.keys(rest).length > 0) writeJsonAtomic(t.file, rest);
    else fs.unlinkSync(t.file);
    results.push({ ...t, removed, exists: true, backup });
  }
  return { results };
}

export const antigravityInstaller: AgentInstaller = {
  install: installAntigravity,
  uninstall: uninstallAntigravity,
  audit: auditAntigravity,
  detect: () => inPath('agy') || dirHasFiles(path.join(os.homedir(), '.gemini', 'antigravity-cli')),
  sweepTargets: antigravitySweepTargets,
  installedIn: antigravityHookIn,
};

// Lire, écrire et inspecter un settings.json Claude Code : la forme des
// crochets, leur reconnaissance, leur ajout/retrait/rafraîchissement.
// Les settings ne sont typés que sur ce que ce module lit/écrit réellement —
// une index signature ouverte tolère le reste (un settings.json porte bien
// d'autres clés que `hooks`).
import fs from 'node:fs';
import path from 'node:path';
import { HOOK_TIMEOUT_SEC } from './types.ts';

export interface HookCommand {
  type: string;
  command?: string;
  timeout?: number;
  [key: string]: unknown;
}
export interface HookEntry {
  hooks?: HookCommand[];
  [key: string]: unknown;
}
export interface ClaudeSettings {
  hooks?: Record<string, HookEntry[]>;
  [key: string]: unknown;
}

// Un objet exploitable par accès de champ — même garde locale que les autres
// fichiers du serveur : `JSON.parse` ne promet qu'un JSON valide, pas un objet.
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// Match three forms used historically + currently:
//   1. node /abs/.../agent-viz/hook.js              (legacy)
//   2. node /abs/.../agent-viz/lib/hook.js          (path-style after refactor)
//   3. node /abs/.../agent-viz/bin/agent-viz.js hook (absolute bin-style)
//   4. agent-viz hook  /  npx @vcueto/agent-viz@X.Y.Z hook   (npx-style)
export function isAgentVizHook(h: unknown): boolean {
  if (!isRecord(h) || h.type !== 'command' || typeof h.command !== 'string') return false;
  const cmd = h.command.replace(/\\/g, '/');
  if (!cmd.includes('agent-viz')) return false;
  return /\/hook\.js(["'\s]|$)/.test(cmd)
      || /agent-viz(?:@[\w.\-]+)?(?:\.js)?["']?\s+hook\b/.test(cmd);
}

// "Standard shape" = a command resolveHookCommand would actually produce
// (node "<path>" hook  OR  npx ... agent-viz... hook). We only auto-update
// stale entries that match this shape, so we never overwrite a hand-rolled
// wrapper command the user added on purpose.
export function isStandardShape(cmd: unknown): boolean {
  if (typeof cmd !== 'string') return false;
  const trimmed = cmd.trim();
  return /^node\s+["']/.test(trimmed) || /^npx\s/.test(trimmed);
}

export function readSettings(file: string): ClaudeSettings {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e: unknown) {
    if (e instanceof Error && 'code' in e && e.code === 'ENOENT') return {};
    const message = e instanceof Error ? e.message : String(e);
    throw new Error(`${file} invalide : ${message}`);
  }
}

export function writeSettings(file: string, settings: ClaudeSettings): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n');
}

export function hasHookForEvent(settings: ClaudeSettings, event: string): boolean {
  const entries = settings.hooks?.[event] || [];
  return entries.some(entry => (entry.hooks || []).some(isAgentVizHook));
}

// Inspect a single event slot. Returns:
//   { present: bool      — at least one agent-viz hook is registered
//     stale:   bool      — an agent-viz hook of standard shape has a command
//                          ≠ desiredCommand OR a timeout ≠ desiredTimeout
//                          (broken absolute path, obsolete npx version,
//                          obsolete timeout from a pre-HOOK_TIMEOUT_SEC install)
//     others:  number    — count of non-agent-viz hooks on the same event
//                          (these will run in parallel with ours)
//   }
export function inspectEvent(
  settings: ClaudeSettings, event: string, desiredCommand: string | undefined, desiredTimeout: number = HOOK_TIMEOUT_SEC,
): { present: boolean; stale: boolean; others: number } {
  const entries = settings.hooks?.[event] || [];
  let present = false;
  let stale = false;
  let others = 0;
  for (const entry of entries) {
    for (const h of entry.hooks || []) {
      if (isAgentVizHook(h)) {
        present = true;
        if (desiredCommand && isStandardShape(h.command)) {
          if (h.command !== desiredCommand) stale = true;
          if (h.timeout !== desiredTimeout) stale = true;
        }
      } else {
        others++;
      }
    }
  }
  return { present, stale, others };
}

// Rewrite the command + timeout of every standard-shape agent-viz hook on
// `event` to the desired values. Custom-wrapper commands (non-standard shape)
// are left alone — user explicitly added them. Returns the count of entries
// actually mutated.
export function refreshStaleCommand(
  settings: ClaudeSettings, event: string, desiredCommand: string, desiredTimeout: number = HOOK_TIMEOUT_SEC,
): number {
  const entries = settings.hooks?.[event] || [];
  let updated = 0;
  for (const entry of entries) {
    for (const h of entry.hooks || []) {
      if (isAgentVizHook(h) && isStandardShape(h.command)) {
        let touched = false;
        if (h.command !== desiredCommand) { h.command = desiredCommand; touched = true; }
        if (h.timeout !== desiredTimeout) { h.timeout = desiredTimeout; touched = true; }
        if (touched) updated++;
      }
    }
  }
  return updated;
}

export function addHook(settings: ClaudeSettings, event: string, command: string): void {
  // `??=` sur une propriété/un accès indexé : la LECTURE qui suit resterait
  // `HookEntry[] | undefined` pour TypeScript (la narrowing par assignation ne
  // traverse pas un accès indexé) — `??` + affectation rend la valeur finale
  // directement, sans changer ce qui est réellement écrit sur `settings`.
  const hooks = settings.hooks ?? (settings.hooks = {});
  const list = hooks[event] ?? (hooks[event] = []);
  list.push({
    hooks: [{ type: 'command', command, timeout: HOOK_TIMEOUT_SEC }],
  });
}

export function removeHook(settings: ClaudeSettings, event: string): number {
  const arr = settings.hooks?.[event];
  if (!arr) return 0;
  let removed = 0;
  const kept: HookEntry[] = [];
  for (const entry of arr) {
    const filtered = (entry.hooks || []).filter(h => !isAgentVizHook(h));
    if (filtered.length !== (entry.hooks || []).length) removed++;
    if (filtered.length > 0) kept.push({ ...entry, hooks: filtered });
  }
  // `arr` vient de `settings.hooks?.[event]` et n'est pas `undefined` (garde
  // ci-dessus) : `settings.hooks` lui-même l'est donc forcément aussi, mais
  // l'accès indexé qui a produit `arr` ne le fait pas SAVOIR à TypeScript ici.
  if (settings.hooks) {
    if (kept.length === 0) delete settings.hooks[event];
    else settings.hooks[event] = kept;
  }
  return removed;
}

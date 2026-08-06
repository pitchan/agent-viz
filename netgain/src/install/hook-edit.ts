import path from 'node:path';
import { asObject, InstallError } from './json-file.js';

const EVENT = 'UserPromptSubmit';
const TIMEOUT_S = 10;

type JsonObject = Record<string, unknown>;

export function buildHookCommand(netgainRoot: string): string {
  const cli = `${path.resolve(netgainRoot).replace(/\\/g, '/')}/dist/cli.js`;
  return `node "${cli}" router-hook`; // quotes : le chemin d'install contient des espaces
}

export function buildHookEntry(netgainRoot: string): JsonObject {
  return { type: 'command', command: buildHookCommand(netgainRoot), timeout: TIMEOUT_S };
}

/**
 * NOTRE hook, y compris périmé (install déplacée) — jamais un hook étranger :
 * string ∧ finit par router-hook ∧ contient netgain.
 */
export function isNetgainRouterHook(command: unknown): boolean {
  return typeof command === 'string' && command.endsWith('router-hook') && /netgain/i.test(command);
}

function isCanonicalEntry(entry: unknown, desired: JsonObject): boolean {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return false;
  const e = entry as JsonObject;
  return (
    Object.keys(e).length === 3 &&
    e['type'] === desired['type'] &&
    e['command'] === desired['command'] &&
    e['timeout'] === desired['timeout']
  );
}

/** hooks[] d'un groupe si exploitable ; un groupe étranger difforme ne peut pas contenir notre hook. */
function groupHooks(group: unknown): unknown[] | undefined {
  if (typeof group !== 'object' || group === null || Array.isArray(group)) return undefined;
  const inner = (group as JsonObject)['hooks'];
  return Array.isArray(inner) ? inner : undefined;
}

/** À nous : prédicat (y compris périmé) OU commande exactement canonique (racine sans « netgain » dans le chemin). */
function isOurs(command: unknown, desired: JsonObject): boolean {
  return isNetgainRouterHook(command) || command === desired['command'];
}

interface PurgeResult {
  groups: unknown[];
  changed: boolean;
  canonicalKept: boolean;
}

/** Purge nos entrées (sauf, au plus, une canonique gardée si keepCanonical) et les groupes ainsi vidés. */
function purgeNetgainEntries(groups: unknown[], desired: JsonObject, keepCanonical: boolean): PurgeResult {
  let changed = false;
  let canonicalKept = false;
  const out: unknown[] = [];
  for (const group of groups) {
    const inner = groupHooks(group);
    if (inner === undefined) {
      out.push(group);
      continue;
    }
    const kept = inner.filter((entry) => {
      const command = typeof entry === 'object' && entry !== null ? (entry as JsonObject)['command'] : undefined;
      if (!isOurs(command, desired)) return true;
      if (keepCanonical && !canonicalKept && isCanonicalEntry(entry, desired)) {
        canonicalKept = true;
        return true;
      }
      changed = true;
      return false;
    });
    if (kept.length === inner.length) {
      out.push(group);
    } else if (kept.length > 0) {
      (group as JsonObject)['hooks'] = kept;
      out.push(group);
    }
    // groupe vidé par notre purge : nettoyé (jamais un groupe étranger vide préexistant)
  }
  return { groups: out, changed, canonicalKept };
}

function eventGroups(hooks: JsonObject): unknown[] | undefined {
  const event = hooks[EVENT];
  if (event === undefined) return undefined;
  if (!Array.isArray(event)) {
    throw new InstallError(`nœud de type inattendu : « hooks » → « ${EVENT} » n'est pas un tableau`);
  }
  return event;
}

export interface EditResult {
  value: JsonObject;
  changed: boolean;
}

export function applyHookOn(root: unknown, netgainRoot: string): EditResult {
  const value = root === undefined ? {} : asObject(root, 'la racine du JSON');
  const desired = buildHookEntry(netgainRoot);

  if (value['hooks'] === undefined) value['hooks'] = {};
  const hooks = asObject(value['hooks'], '« hooks »');
  if (hooks[EVENT] === undefined) hooks[EVENT] = [];
  const purge = purgeNetgainEntries(eventGroups(hooks) as unknown[], desired, true);
  let changed = purge.changed;
  if (!purge.canonicalKept) {
    purge.groups.push({ hooks: [desired] });
    changed = true;
  }
  hooks[EVENT] = purge.groups;
  return { value, changed };
}

export function applyHookOff(root: unknown, netgainRoot: string): EditResult {
  const value = root === undefined ? {} : asObject(root, 'la racine du JSON');
  if (value['hooks'] === undefined) return { value, changed: false };
  const hooks = asObject(value['hooks'], '« hooks »');
  const groups = eventGroups(hooks);
  if (groups === undefined) return { value, changed: false };

  const purge = purgeNetgainEntries(groups, buildHookEntry(netgainRoot), false);
  if (!purge.changed) return { value, changed: false };
  hooks[EVENT] = purge.groups;
  if (purge.groups.length === 0) delete hooks[EVENT]; // événement vidé par notre purge
  if (Object.keys(hooks).length === 0) delete value['hooks']; // conteneur vidé — jamais le fichier
  return { value, changed: true };
}

export interface HookPresence {
  present: boolean;
  canonical: boolean;
}

/** Lecture tolérante (status) : une structure difforme = hook absent, jamais d'erreur. */
export function hasNetgainHook(root: unknown, netgainRoot: string): HookPresence {
  const desired = buildHookEntry(netgainRoot);
  let present = false;
  let canonical = false;
  if (typeof root === 'object' && root !== null && !Array.isArray(root)) {
    const hooks = (root as JsonObject)['hooks'];
    const event = typeof hooks === 'object' && hooks !== null ? (hooks as JsonObject)[EVENT] : undefined;
    for (const group of Array.isArray(event) ? event : []) {
      for (const entry of groupHooks(group) ?? []) {
        const command = typeof entry === 'object' && entry !== null ? (entry as JsonObject)['command'] : undefined;
        if (!isOurs(command, desired)) continue;
        present = true;
        if (isCanonicalEntry(entry, desired)) canonical = true;
      }
    }
  }
  return { present, canonical };
}

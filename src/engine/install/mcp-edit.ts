import path from 'node:path';
import { asObject } from './json-file.js';
import { canonicalProjectKey, samePath } from './paths.js';

export const MCP_SERVER_NAME = 'netgain-map';

type JsonObject = Record<string, unknown>;

export interface EditResult {
  value: JsonObject;
  changed: boolean;
}

/** Les valeurs (args) restent en forward slashes — les deux formats marchent dans les valeurs. */
function toPosixValue(p: string): string {
  return path.resolve(p).replace(/\\/g, '/');
}

export function buildMcpEntry(netgainRoot: string, repoDir: string): JsonObject {
  return {
    type: 'stdio',
    command: 'node',
    args: [`${toPosixValue(netgainRoot)}/dist/engine/mcp/main.js`, toPosixValue(repoDir)],
  };
}

function isDesiredEntry(actual: unknown, desired: JsonObject): boolean {
  if (typeof actual !== 'object' || actual === null || Array.isArray(actual)) return false;
  const a = actual as JsonObject;
  const desiredArgs = desired['args'] as string[];
  return (
    Object.keys(a).length === 3 &&
    a['type'] === desired['type'] &&
    a['command'] === desired['command'] &&
    Array.isArray(a['args']) &&
    a['args'].length === desiredArgs.length &&
    (a['args'] as unknown[]).every((v, i) => v === desiredArgs[i])
  );
}

/** Toutes les clés de `projects` qui désignent ce repo (posix, backslash, casse). */
export function findProjectKeys(root: unknown, repoDir: string): string[] {
  if (root === undefined) return [];
  const rootObj = asObject(root, 'la racine du JSON');
  if (rootObj['projects'] === undefined) return [];
  const projects = asObject(rootObj['projects'], '« projects »');
  return Object.keys(projects).filter((k) => samePath(k, repoDir));
}

/** Retire netgain-map du mcpServers d'un projet ; ne touche à rien d'autre. */
function removeEntry(projects: JsonObject, key: string): boolean {
  const project = asObject(projects[key], `« projects » → « ${key} »`);
  if (project['mcpServers'] === undefined) return false;
  const servers = asObject(project['mcpServers'], `mcpServers de « ${key} »`);
  if (!(MCP_SERVER_NAME in servers)) return false;
  delete servers[MCP_SERVER_NAME];
  return true;
}

/**
 * Upsert dans la clé CANONIQUE exacte (posix, créée si absente) et purge de notre
 * entrée toute autre variante samePath → après on, exactement une clé porte l'entrée.
 */
export function applyMcpOn(root: unknown, netgainRoot: string, repoDir: string): EditResult {
  const value = root === undefined ? {} : asObject(root, 'la racine du JSON');
  const desired = buildMcpEntry(netgainRoot, repoDir);
  const canonicalKey = canonicalProjectKey(repoDir);
  let changed = false;

  if (value['projects'] === undefined) value['projects'] = {};
  const projects = asObject(value['projects'], '« projects »');

  for (const key of Object.keys(projects).filter((k) => k !== canonicalKey && samePath(k, repoDir))) {
    if (removeEntry(projects, key)) changed = true;
  }

  if (projects[canonicalKey] === undefined) projects[canonicalKey] = {};
  const project = asObject(projects[canonicalKey], `« projects » → « ${canonicalKey} »`);
  if (project['mcpServers'] === undefined) project['mcpServers'] = {};
  const servers = asObject(project['mcpServers'], `mcpServers de « ${canonicalKey} »`);
  if (!isDesiredEntry(servers[MCP_SERVER_NAME], desired)) {
    servers[MCP_SERVER_NAME] = desired;
    changed = true;
  }
  return { value, changed };
}

/** Purge notre entrée de TOUTES les variantes samePath ; clés étrangères intactes. */
export function applyMcpOff(root: unknown, repoDir: string): EditResult {
  const value = root === undefined ? {} : asObject(root, 'la racine du JSON');
  let changed = false;
  for (const key of findProjectKeys(value, repoDir)) {
    const projects = value['projects'] as JsonObject;
    if (removeEntry(projects, key)) changed = true;
  }
  return { value, changed };
}

export interface McpPresence {
  present: boolean;
  /** true si l'entrée exacte est portée par la clé canonique (posix). */
  canonical: boolean;
  /** Les variantes qui portent une entrée netgain-map. */
  keys: string[];
}

export function hasCanonicalMcp(root: unknown, netgainRoot: string, repoDir: string): McpPresence {
  const desired = buildMcpEntry(netgainRoot, repoDir);
  const canonicalKey = canonicalProjectKey(repoDir);
  const keys: string[] = [];
  let canonical = false;
  for (const key of findProjectKeys(root, repoDir)) {
    const projects = (root as JsonObject)['projects'] as JsonObject;
    const project = projects[key];
    if (typeof project !== 'object' || project === null) continue;
    const servers = (project as JsonObject)['mcpServers'];
    if (typeof servers !== 'object' || servers === null) continue;
    if (MCP_SERVER_NAME in (servers as JsonObject)) {
      keys.push(key);
      if (key === canonicalKey && isDesiredEntry((servers as JsonObject)[MCP_SERVER_NAME], desired)) {
        canonical = true;
      }
    }
  }
  return { present: keys.length > 0, canonical, keys };
}

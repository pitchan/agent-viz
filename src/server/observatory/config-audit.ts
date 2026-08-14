'use strict';
// Configuration inventory — what is loaded. What is *used* is a different
// question and lives in mcp-usage.js.
//
// Metadata only: names, scopes, counts and file sizes. The content of a
// CLAUDE.md or a SKILL.md is never read into a stored field.
//
// Every source is optional. A user with no MCP servers is a normal user, not
// an error, so an unreadable or malformed source contributes zero items and
// leaves the others intact. Sources are declared in a table (CLAUDE.md § O):
// adding "agents" or "output styles" later is one entry, not a new branch.

import path from 'node:path';
import type { ConfigItem } from './rules/types.ts';

type ReadFile = (filePath: string, encoding: 'utf8') => Promise<string>;
interface DirEntry {
  name: string;
  isDirectory(): boolean;
}
type ReadDir = (dirPath: string, opts: { withFileTypes: true }) => Promise<DirEntry[]>;

interface Deps {
  readFile: ReadFile;
  readdir: ReadDir;
}
interface Options {
  claudeDir: string;
  claudeJsonPath: string;
}

// The parsed JSON of a config file is `unknown` — narrowed here rather than
// assumed, the same discipline the plan asks of anything an external file
// hands back.
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
const asRecord = (v: unknown): Record<string, unknown> => (isRecord(v) ? v : {});

async function readJson(readFile: ReadFile, filePath: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function mcpDetail(cfg: unknown): { transport: string; commandName: string | null } {
  const c = asRecord(cfg);
  return {
    transport: typeof c.type === 'string' ? c.type : 'stdio',
    commandName: typeof c.command === 'string' ? c.command : null,
  };
}

// ~/.claude.json — servers at the root are user-wide; those under projects[k]
// are scoped to that project. Keys of `projects` use POSIX separators even on
// Windows, so the key is used verbatim as the scope suffix.
async function collectMcp({ readFile }: Deps, { claudeJsonPath }: Options): Promise<ConfigItem[]> {
  const cfg = await readJson(readFile, claudeJsonPath);
  if (!isRecord(cfg)) return [];
  const items: ConfigItem[] = [];
  for (const [name, server] of Object.entries(asRecord(cfg.mcpServers))) {
    items.push({ kind: 'mcp', name, scope: 'user', detail: mcpDetail(server) });
  }
  for (const [projectKey, project] of Object.entries(asRecord(cfg.projects))) {
    for (const [name, server] of Object.entries(asRecord(asRecord(project).mcpServers))) {
      items.push({ kind: 'mcp', name, scope: `project:${projectKey}`, detail: mcpDetail(server) });
    }
  }
  return items;
}

async function collectPlugins({ readFile }: Deps, { claudeDir }: Options): Promise<ConfigItem[]> {
  const cfg = await readJson(readFile, path.join(claudeDir, 'plugins', 'installed_plugins.json'));
  if (!isRecord(cfg)) return [];
  return Object.entries(asRecord(cfg.plugins)).map(([name, installs]) => ({
    kind: 'plugin', name, scope: 'user',
    detail: { scopes: Array.isArray(installs) ? installs.length : 0 },
  }));
}

async function collectSkills({ readFile, readdir }: Deps, { claudeDir }: Options): Promise<ConfigItem[]> {
  let entries: DirEntry[];
  try {
    entries = await readdir(path.join(claudeDir, 'skills'), { withFileTypes: true });
  } catch {
    return [];
  }
  const items: ConfigItem[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    let bytes: number;
    try {
      bytes = (await readFile(path.join(claudeDir, 'skills', entry.name, 'SKILL.md'), 'utf8')).length;
    } catch {
      continue;
    }
    items.push({ kind: 'skill', name: entry.name, scope: 'user', detail: { bytes } });
  }
  return items;
}

async function collectHooks({ readFile }: Deps, { claudeDir }: Options): Promise<ConfigItem[]> {
  const cfg = await readJson(readFile, path.join(claudeDir, 'settings.json'));
  if (!isRecord(cfg)) return [];
  return Object.entries(asRecord(cfg.hooks)).map(([event, matchers]) => ({
    kind: 'hook', name: event, scope: 'user',
    detail: { matchers: Array.isArray(matchers) ? matchers.length : 0 },
  }));
}

async function collectClaudeMd({ readFile }: Deps, { claudeDir }: Options): Promise<ConfigItem[]> {
  try {
    const bytes = (await readFile(path.join(claudeDir, 'CLAUDE.md'), 'utf8')).length;
    return [{ kind: 'claude_md', name: 'CLAUDE.md', scope: 'user', detail: { bytes } }];
  } catch {
    return [];
  }
}

const SOURCES: Array<(deps: Deps, options: Options) => Promise<ConfigItem[]>> =
  [collectMcp, collectPlugins, collectSkills, collectHooks, collectClaudeMd];

async function collectConfigItems(deps: Deps, options: Options): Promise<ConfigItem[]> {
  const perSource = await Promise.all(SOURCES.map(collect => collect(deps, options)));
  return perSource.flat();
}

export { collectConfigItems };

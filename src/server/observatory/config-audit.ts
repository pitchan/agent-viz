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

async function readJson(readFile, filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function mcpDetail(cfg) {
  return {
    transport: typeof cfg?.type === 'string' ? cfg.type : 'stdio',
    commandName: typeof cfg?.command === 'string' ? cfg.command : null,
  };
}

// ~/.claude.json — servers at the root are user-wide; those under projects[k]
// are scoped to that project. Keys of `projects` use POSIX separators even on
// Windows, so the key is used verbatim as the scope suffix.
async function collectMcp({ readFile }, { claudeJsonPath }) {
  const cfg = await readJson(readFile, claudeJsonPath);
  if (!cfg) return [];
  const items = [];
  for (const [name, server] of Object.entries(cfg.mcpServers ?? {})) {
    items.push({ kind: 'mcp', name, scope: 'user', detail: mcpDetail(server) });
  }
  for (const [projectKey, project] of Object.entries(cfg.projects ?? {})) {
    for (const [name, server] of Object.entries(project?.mcpServers ?? {})) {
      items.push({ kind: 'mcp', name, scope: `project:${projectKey}`, detail: mcpDetail(server) });
    }
  }
  return items;
}

async function collectPlugins({ readFile }, { claudeDir }) {
  const cfg = await readJson(readFile, path.join(claudeDir, 'plugins', 'installed_plugins.json'));
  if (!cfg) return [];
  return Object.entries(cfg.plugins ?? {}).map(([name, installs]) => ({
    kind: 'plugin', name, scope: 'user',
    detail: { scopes: Array.isArray(installs) ? installs.length : 0 },
  }));
}

async function collectSkills({ readFile, readdir }, { claudeDir }) {
  let entries;
  try {
    entries = await readdir(path.join(claudeDir, 'skills'), { withFileTypes: true });
  } catch {
    return [];
  }
  const items = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    let bytes;
    try {
      bytes = (await readFile(path.join(claudeDir, 'skills', entry.name, 'SKILL.md'), 'utf8')).length;
    } catch {
      continue;
    }
    items.push({ kind: 'skill', name: entry.name, scope: 'user', detail: { bytes } });
  }
  return items;
}

async function collectHooks({ readFile }, { claudeDir }) {
  const cfg = await readJson(readFile, path.join(claudeDir, 'settings.json'));
  if (!cfg) return [];
  return Object.entries(cfg.hooks ?? {}).map(([event, matchers]) => ({
    kind: 'hook', name: event, scope: 'user',
    detail: { matchers: Array.isArray(matchers) ? matchers.length : 0 },
  }));
}

async function collectClaudeMd({ readFile }, { claudeDir }) {
  try {
    const bytes = (await readFile(path.join(claudeDir, 'CLAUDE.md'), 'utf8')).length;
    return [{ kind: 'claude_md', name: 'CLAUDE.md', scope: 'user', detail: { bytes } }];
  } catch {
    return [];
  }
}

const SOURCES = [collectMcp, collectPlugins, collectSkills, collectHooks, collectClaudeMd];

async function collectConfigItems(deps, options) {
  const perSource = await Promise.all(SOURCES.map(collect => collect(deps, options)));
  return perSource.flat();
}

export { collectConfigItems };

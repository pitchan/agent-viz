'use strict';
// Configuration inventory. Filesystem access is injected, so the fixtures are
// plain objects — no temp trees, no reliance on the developer's own ~/.claude.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { collectConfigItems } = require('../../lib/server/observatory/config-audit');

const CLAUDE_JSON = JSON.stringify({
  mcpServers: { 'mdb-explorer': { command: 'node', args: ['x.js'] } },
  projects: { 'F:/DEV/agent-viz': { mcpServers: { playwright: { type: 'sse', url: 'http://x' } } } },
});
const PLUGINS = JSON.stringify({
  version: 2, plugins: { 'superpowers@official': [{ scope: 'project' }, { scope: 'project' }] },
});
const SETTINGS = JSON.stringify({
  hooks: { PreToolUse: [{ matcher: 'Bash' }, { matcher: 'Read' }], Stop: [{ matcher: '*' }] },
});

function deps(over = {}) {
  const files = {
    'C:/u/.claude.json': CLAUDE_JSON,
    'C:/u/.claude/plugins/installed_plugins.json': PLUGINS,
    'C:/u/.claude/settings.json': SETTINGS,
    'C:/u/.claude/CLAUDE.md': 'x'.repeat(1234),
    'C:/u/.claude/skills/pdf/SKILL.md': 'y'.repeat(500),
    ...over.files,
  };
  const norm = p => p.replace(/\\/g, '/');
  return {
    readFile: async p => {
      const v = files[norm(p)];
      if (v === undefined) throw new Error('ENOENT');
      return v;
    },
    readdir: async p => {
      if (norm(p).endsWith('/skills')) return over.skills ?? [{ name: 'pdf', isDirectory: () => true }];
      throw new Error('ENOENT');
    },
  };
}

const OPTS = { claudeDir: 'C:/u/.claude', claudeJsonPath: 'C:/u/.claude.json' };
const pick = (items, kind) => items.filter(i => i.kind === kind);

test('user-scope and project-scope MCP servers are both inventoried', async () => {
  assert.deepEqual(pick(await collectConfigItems(deps(), OPTS), 'mcp'), [
    { kind: 'mcp', name: 'mdb-explorer', scope: 'user', detail: { transport: 'stdio', commandName: 'node' } },
    { kind: 'mcp', name: 'playwright', scope: 'project:F:/DEV/agent-viz', detail: { transport: 'sse', commandName: null } },
  ]);
});

test('plugins report how many scopes install them', async () => {
  assert.deepEqual(pick(await collectConfigItems(deps(), OPTS), 'plugin'),
    [{ kind: 'plugin', name: 'superpowers@official', scope: 'user', detail: { scopes: 2 } }]);
});

test('skills are inventoried by directory, with size only — never content', async () => {
  assert.deepEqual(pick(await collectConfigItems(deps(), OPTS), 'skill'),
    [{ kind: 'skill', name: 'pdf', scope: 'user', detail: { bytes: 500 } }]);
});

test('hooks are counted per event, not stored as commands', async () => {
  assert.deepEqual(pick(await collectConfigItems(deps(), OPTS), 'hook'), [
    { kind: 'hook', name: 'PreToolUse', scope: 'user', detail: { matchers: 2 } },
    { kind: 'hook', name: 'Stop', scope: 'user', detail: { matchers: 1 } },
  ]);
});

test('CLAUDE.md is inventoried by size only', async () => {
  assert.deepEqual(pick(await collectConfigItems(deps(), OPTS), 'claude_md'),
    [{ kind: 'claude_md', name: 'CLAUDE.md', scope: 'user', detail: { bytes: 1234 } }]);
});

test('every source missing yields an empty inventory, never a throw', async () => {
  const empty = { readFile: async () => { throw new Error('ENOENT'); },
    readdir: async () => { throw new Error('ENOENT'); } };
  assert.deepEqual(await collectConfigItems(empty, OPTS), []);
});

test('malformed JSON in one source does not lose the other sources', async () => {
  const items = await collectConfigItems(deps({ files: { 'C:/u/.claude.json': '{ not json' } }), OPTS);
  assert.equal(pick(items, 'mcp').length, 0);
  assert.equal(pick(items, 'skill').length, 1);
});

test('a skills directory entry that is not a directory is ignored', async () => {
  const d = deps({ skills: [{ name: 'readme.txt', isDirectory: () => false }] });
  assert.deepEqual(pick(await collectConfigItems(d, OPTS), 'skill'), []);
});

'use strict';
// What was actually called, extracted from the engine's byTool breakdown.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { serverNameOf, mcpUsageBySession } = require('../../src/server/observatory/mcp-usage.ts');

const session = (id, byTool) => ({ id, report: { toolResults: { byTool } } });

test('serverNameOf extracts the server between the two double underscores', () => {
  assert.equal(serverNameOf('mcp__mdb-explorer__mdb_geocode'), 'mdb-explorer');
  assert.equal(serverNameOf('mcp__claude_ai_Gmail__get_message'), 'claude_ai_Gmail');
});

test('serverNameOf returns null for anything that is not an MCP tool', () => {
  assert.equal(serverNameOf('Bash'), null);
  assert.equal(serverNameOf('mcp__incomplete'), null);
  assert.equal(serverNameOf(''), null);
});

test('usage counts calls and distinct sessions per server', () => {
  const usage = mcpUsageBySession([
    session('s1', { 'mcp__a__x': { count: 2, bytes: 10 }, Bash: { count: 5, bytes: 10 } }),
    session('s2', { 'mcp__a__y': { count: 3, bytes: 10 }, 'mcp__b__z': { count: 1, bytes: 10 } }),
  ]);
  assert.equal(usage.get('a').calls, 5);
  assert.deepEqual([...usage.get('a').sessions].sort(), ['s1', 's2']);
  assert.equal(usage.get('b').calls, 1);
  assert.equal(usage.has('Bash'), false);
});

test('no sessions yields an empty map, never undefined', () => {
  assert.equal(mcpUsageBySession([]).size, 0);
});

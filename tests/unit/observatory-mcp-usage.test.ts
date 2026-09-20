// What was actually called, extracted from the engine's byTool breakdown.

import { expect, test } from 'vitest';
import { serverNameOf, mcpUsageBySession } from '../../src/server/observatory/mcp-usage.ts';
import type { Session } from '../../src/server/observatory/rules/types.ts';

const session = (id: string, byTool: Record<string, { count: number; bytes: number }>) =>
  ({ id, report: { toolResults: { byTool } } }) as unknown as Session;

test('serverNameOf extracts the server between the two double underscores', () => {
  expect(serverNameOf('mcp__mdb-explorer__mdb_geocode')).toBe('mdb-explorer');
  expect(serverNameOf('mcp__claude_ai_Gmail__get_message')).toBe('claude_ai_Gmail');
});

test('serverNameOf returns null for anything that is not an MCP tool', () => {
  expect(serverNameOf('Bash')).toBe(null);
  expect(serverNameOf('mcp__incomplete')).toBe(null);
  expect(serverNameOf('')).toBe(null);
});

test('usage counts calls and distinct sessions per server', () => {
  const usage = mcpUsageBySession([
    session('s1', { 'mcp__a__x': { count: 2, bytes: 10 }, Bash: { count: 5, bytes: 10 } }),
    session('s2', { 'mcp__a__y': { count: 3, bytes: 10 }, 'mcp__b__z': { count: 1, bytes: 10 } }),
  ]);
  expect(usage.get('a')!.calls).toBe(5);
  expect([...usage.get('a')!.sessions].sort()).toEqual(['s1', 's2']);
  expect(usage.get('b')!.calls).toBe(1);
  expect(usage.has('Bash')).toBe(false);
});

test('no sessions yields an empty map, never undefined', () => {
  expect(mcpUsageBySession([]).size).toBe(0);
});

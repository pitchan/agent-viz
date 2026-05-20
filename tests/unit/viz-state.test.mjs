// Smoke tests for pure helpers in public/viz-state.js. No DOM access here,
// so the module imports cleanly under Node ESM.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMcpName, state } from '../../public/viz-state.js';

test('parseMcpName: plugin_ prefix stripped + repeated segments dedup', () => {
  assert.deepEqual(
    parseMcpName('mcp__plugin_playwright_playwright__browser_click'),
    { label: 'browser_click', sub: 'playwright' }
  );
});

test('parseMcpName: server segments preserved when no known prefix', () => {
  assert.deepEqual(
    parseMcpName('mcp__Claude_in_Chrome__navigate'),
    { label: 'navigate', sub: 'Claude_in_Chrome' }
  );
});

test('parseMcpName: non-mcp tool name passes through with empty sub', () => {
  assert.deepEqual(parseMcpName('Bash'), { label: 'Bash', sub: '' });
});

test('parseMcpName: null/empty falls back to "MCP"', () => {
  assert.deepEqual(parseMcpName(null), { label: 'MCP', sub: '' });
  assert.deepEqual(parseMcpName(''), { label: 'MCP', sub: '' });
});

test('state.tokens.tokensSupported defaults to null (unknown until first SSE)', () => {
  // Null — not true, not false — so the UI can distinguish "haven't heard
  // from the server yet" from "server told us tokens are unavailable".
  // Booting straight to true would briefly show a fake gauge for Copilot.
  assert.equal(state.tokens.tokensSupported, null);
});

test('state.tokens.transcriptMissing defaults to false', () => {
  // No "transcript not located" placeholder until the server actually says so.
  assert.equal(state.tokens.transcriptMissing, false);
});

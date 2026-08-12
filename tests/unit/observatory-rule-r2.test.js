'use strict';
// R2 — an MCP server is configured almost everywhere but almost never called.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const r2 = require('../../src/server/observatory/rules/r2-unused-mcp');

function session(id, { project = 'F--proj', cwd = 'F:/DEV/proj', byTool = {}, toolsAppeared = 0,
  netTokens = 100000, costUsd = 10, costComplete = true } = {}) {
  return {
    id, project, startedAt: '2026-07-01T10:00:00.000Z', endedAt: '2026-07-01T11:00:00.000Z',
    netTokens, costUsd, costComplete,
    report: {
      cwd,
      toolResults: { byTool },
      context: {
        prefixBreakdown: {
          markers: { toolsAppeared: { events: 1, tokens: toolsAppeared } },
          noMarkerDetail: { earlyMcp: { events: 0, tokens: 0 }, other: { events: 0, tokens: 0 } },
        },
      },
    },
  };
}

const userMcp = name => ({ kind: 'mcp', name, scope: 'user', detail: { transport: 'stdio' } });
const projectMcp = (name, key) => ({ kind: 'mcp', name, scope: `project:${key}`, detail: { transport: 'stdio' } });

test('a user-scope server never called fires, priced on measured tool-block churn', () => {
  const recs = r2.evaluate({
    sessions: [session('s1', { toolsAppeared: 20000 }), session('s2'), session('s3')],
    configItems: [userMcp('mdb-explorer')],
  });
  assert.equal(recs.length, 1);
  assert.equal(recs[0].ruleId, 'R2');
  assert.equal(recs[0].subject, 'mdb-explorer@user');
  assert.equal(recs[0].confidence, 'fait');
  assert.equal(recs[0].costBasis, 'jetons-mesures');
  assert.equal(recs[0].estimatedCostUsd, 2);
  assert.equal(recs[0].evidence.loadedSessions, 3);
  assert.equal(recs[0].evidence.usedSessions, 0);
  assert.equal(recs[0].evidence.inventorySnapshot, true);
  assert.ok(recs[0].action.includes('à tester'));
  assert.deepEqual(recs[0].evidence.projects, ['F--proj'],
    'R2 names the projects its loaded sessions belong to (needed by the P3 pointer)');
});

test('a server used in more than 10 % of its sessions stays silent', () => {
  const recs = r2.evaluate({
    sessions: [
      session('s1', { byTool: { 'mcp__mdb-explorer__mdb_geocode': { count: 3, bytes: 100 } } }),
      session('s2'), session('s3'), session('s4'), session('s5'),
    ],
    configItems: [userMcp('mdb-explorer')],
  });
  assert.deepEqual(recs, []);
});

test('a project-scope server is only loaded in the sessions of that project', () => {
  const recs = r2.evaluate({
    sessions: [
      session('s1', { cwd: 'F:/DEV/agent-viz' }),
      session('s2', { cwd: 'F:/DEV/agent-viz' }),
      session('s3', { cwd: 'F:/DEV/other' }),
    ],
    configItems: [projectMcp('playwright', 'F:/DEV/agent-viz')],
  });
  assert.equal(recs.length, 1);
  assert.equal(recs[0].evidence.loadedSessions, 2);
});

test('a project-scope server loaded in under half the period stays silent', () => {
  const recs = r2.evaluate({
    sessions: [
      session('s1', { cwd: 'F:/DEV/agent-viz' }),
      session('s2', { cwd: 'F:/DEV/other' }), session('s3', { cwd: 'F:/DEV/other' }),
      session('s4', { cwd: 'F:/DEV/other' }),
    ],
    configItems: [projectMcp('playwright', 'F:/DEV/agent-viz')],
  });
  assert.deepEqual(recs, []);
});

test('path separators do not decide the match — backslash cwd, POSIX config key', () => {
  const recs = r2.evaluate({
    sessions: [session('s1', { cwd: 'F:\\DEV\\agent-viz' }), session('s2', { cwd: 'F:\\DEV\\agent-viz' })],
    configItems: [projectMcp('playwright', 'F:/DEV/agent-viz')],
  });
  assert.equal(recs.length, 1);
  assert.equal(recs[0].evidence.loadedSessions, 2);
});

test('a server whose tools are named with underscores is matched correctly', () => {
  const recs = r2.evaluate({
    sessions: [
      session('s1', { byTool: { 'mcp__claude_ai_Gmail__get_message': { count: 4, bytes: 10 } } }),
      session('s2', { byTool: { 'mcp__claude_ai_Gmail__list_labels': { count: 1, bytes: 10 } } }),
    ],
    configItems: [userMcp('claude_ai_Gmail')],
  });
  assert.deepEqual(recs, [], 'used in 100 % of sessions — must not fire');
});

test('with no measurable tool-block churn the recommendation costs zero, and still lists', () => {
  const recs = r2.evaluate({
    sessions: [session('s1'), session('s2')],
    configItems: [userMcp('mdb-explorer')],
  });
  assert.equal(recs.length, 1);
  assert.equal(recs[0].estimatedCostUsd, 0);
});

test('non-MCP config items and empty session lists are ignored', () => {
  assert.deepEqual(r2.evaluate({ sessions: [session('s1')],
    configItems: [{ kind: 'skill', name: 'pdf', scope: 'user', detail: {} }] }), []);
  assert.deepEqual(r2.evaluate({ sessions: [], configItems: [userMcp('x')] }), []);
});

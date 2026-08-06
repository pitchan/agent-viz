// Pure parts of the analysis page: the table row and the drill-down lines.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sessionRow, drillDownLines } from '../../public/observatory/analysis-view.js';

test('a session row carries id, project, model, cost, tokens, duration and kind — 7 cells', () => {
  assert.deepEqual(sessionRow({
    id: 'sess-abcdef12', project: 'F--proj', modelMain: 'claude-opus-4-8',
    costUsd: 1.5, costComplete: true, netTokens: 1200000,
    startedAt: '2026-07-01T10:00:00.000Z', endedAt: '2026-07-01T10:30:00.000Z',
    sessionKind: 'interactive',
  }), ['sess-abc', 'F--proj', 'claude-opus-4-8', '1,50 $', '1.2M', '30 min', 'humain']);
});

// The "Projet" cell shows the real working directory the service resolved. The
// slug stays the fallback — the test above, which passes no projectPath at all,
// pins that fallback and must keep passing untouched.
test('the project cell shows the real path when the service resolved one', () => {
  assert.equal(sessionRow({
    id: 'sess-abcdef12', project: 'F--DEV-Demo-IA-OPTIM-SKILLS-TOKEN-SAVERS',
    projectPath: 'F:\\DEV\\Demo IA OPTIM\\SKILLS TOKEN SAVERS',
    modelMain: 'claude-opus-5', costUsd: 1, costComplete: true, netTokens: 10,
    startedAt: null, endedAt: null, sessionKind: 'interactive',
  })[1], 'F:\\DEV\\Demo IA OPTIM\\SKILLS TOKEN SAVERS');
});

test('sessionRow shows the kind badge — headless → machine, null/unknown → ?', () => {
  const base = {
    id: 's', project: 'p', modelMain: 'm', costUsd: 1, costComplete: true, netTokens: 10,
    startedAt: null, endedAt: null,
  };
  assert.equal(sessionRow({ ...base, sessionKind: 'headless' }).length, 7);
  assert.equal(sessionRow({ ...base, sessionKind: 'headless' })[6], 'machine');
  // A null kind is a pre-migration row: never displayed as human.
  assert.equal(sessionRow({ ...base, sessionKind: null })[6], '?');
  assert.equal(sessionRow({ ...base, sessionKind: 'unknown' })[6], '?');
});

test('a partially-priced session is marked in its cost cell', () => {
  assert.equal(sessionRow({
    id: 's', project: 'p', modelMain: 'm', costUsd: 1, costComplete: false, netTokens: 10,
    startedAt: null, endedAt: null,
  })[3], '1,00 $ (partiel)');
});

test('a session with no known model shows a dash, not an empty cell', () => {
  assert.equal(sessionRow({
    id: 's', project: 'p', modelMain: null, costUsd: 0, costComplete: true, netTokens: 0,
    startedAt: null, endedAt: null,
  })[2], '—');
});

const fullReport = {
  netTokens: 1000, tokens: { total: { cacheRead: 4000 } },
  context: { cacheChurnTokens: 500, churnCauses: { prefixChange: { tokens: 300 } }, compactions: [{}, {}] },
  toolResults: { totalResults: 12, totalBytes: 60000 },
  reads: { cases: { crossAgentDuplicate: { bytes: 2048 } } },
  subagents: { spawnToolUses: 3, sidecarCount: 2 },
  parseErrors: 1,
};

test('the drill-down keeps net tokens and cache reads on separate lines', () => {
  const lines = drillDownLines(fullReport);
  assert.ok(lines.some(l => l.includes('1000 jetons nets')));
  assert.ok(lines.some(l => l.includes('4000 jetons relus depuis le cache')));
  assert.ok(!lines.some(l => /5000/.test(l)), 'the two must never be added together');
});

test('the drill-down lists every non-zero figure of the report', () => {
  const lines = drillDownLines(fullReport);
  assert.ok(lines.some(l => l.includes('300') && l.includes('préfixe modifié')));
  assert.ok(lines.some(l => l.includes('2 compactions')));
  assert.ok(lines.some(l => l.includes('12 sorties d’outils')));
  assert.ok(lines.some(l => l.includes('relus par un autre agent')));
  assert.ok(lines.some(l => l.includes('3 sous-agents lancés')));
  assert.ok(lines.some(l => l.includes('non analysable')));
});

test('a clean session does not list a line of zeros', () => {
  const lines = drillDownLines({
    netTokens: 10, tokens: { total: { cacheRead: 0 } },
    context: { cacheChurnTokens: 0, churnCauses: { prefixChange: { tokens: 0 } }, compactions: [] },
    toolResults: { totalResults: 0, totalBytes: 0 },
    reads: { cases: { crossAgentDuplicate: { bytes: 0 } } },
    subagents: { spawnToolUses: 0, sidecarCount: 0 },
    parseErrors: 0,
  });
  assert.equal(lines.length, 1, 'only the tokens line remains');
  assert.ok(!lines.some(l => l.includes('non analysable')));
});

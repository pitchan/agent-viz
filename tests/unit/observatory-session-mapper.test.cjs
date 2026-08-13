'use strict';
// Translation between the persisted row and the shape the rules consume.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { mainModelOf, toSessionRow, toAnalysedSession }
  = require('../../src/server/observatory/session-mapper.ts');

const report = {
  sessionId: 's1', projectSlug: 'F--proj',
  startedAt: '2026-07-01T10:00:00.000Z', endedAt: '2026-07-01T10:20:00.000Z',
  netTokens: 1000,
  tokens: {
    costUsd: 0.5, costComplete: true,
    perModel: {
      'claude-opus-4-8': { in: 100, out: 50, cacheCreate: 850, cacheRead: 4000 },
      'claude-haiku-4-5': { in: 10, out: 5, cacheCreate: 5, cacheRead: 0 },
    },
  },
};
const ref = { mainPath: 'F:\\p\\s1.jsonl', mtime: new Date(1000), sizeBytes: 2048 };

test('mainModelOf picks the model with the most net tokens', () => {
  assert.equal(mainModelOf(report), 'claude-opus-4-8');
});

test('mainModelOf returns null rather than an empty string when no model is known', () => {
  assert.equal(mainModelOf({ ...report, tokens: { ...report.tokens, perModel: {} } }), null);
});

test('mainModelOf ranks on net tokens, cacheRead excluded', () => {
  const cacheHeavy = { ...report, tokens: { ...report.tokens, perModel: {
    a: { in: 1, out: 1, cacheCreate: 1, cacheRead: 999999 },
    b: { in: 50, out: 50, cacheCreate: 50, cacheRead: 0 },
  } } };
  assert.equal(mainModelOf(cacheHeavy), 'b');
});

test('toSessionRow carries the incremental key and serialises the report once', () => {
  const row = toSessionRow(report, ref, 7);
  assert.equal(row.id, 's1');
  assert.equal(row.project, 'F--proj');
  assert.equal(row.transcriptPath, 'F:\\p\\s1.jsonl');
  assert.equal(row.fileMtime, 1000);
  assert.equal(row.fileSize, 2048);
  assert.equal(row.scanVersion, 7);
  assert.equal(row.modelMain, 'claude-opus-4-8');
  assert.equal(row.costComplete, true);
  assert.equal(JSON.parse(row.reportJson).sessionId, 's1');
});

test('toAnalysedSession is the exact inverse for everything the rules read', () => {
  const analysed = toAnalysedSession(toSessionRow(report, ref, 1));
  assert.deepEqual(
    { id: analysed.id, project: analysed.project, startedAt: analysed.startedAt,
      endedAt: analysed.endedAt, netTokens: analysed.netTokens,
      costUsd: analysed.costUsd, costComplete: analysed.costComplete },
    { id: 's1', project: 'F--proj', startedAt: '2026-07-01T10:00:00.000Z',
      endedAt: '2026-07-01T10:20:00.000Z', netTokens: 1000, costUsd: 0.5, costComplete: true });
  assert.equal(analysed.report.sessionId, 's1');
});

test('toSessionRow carries the engine sessionKind and toAnalysedSession restores it', () => {
  const report = {
    sessionId: 's-kind', projectSlug: 'F--p', startedAt: null, endedAt: null,
    sessionKind: 'headless', netTokens: 1,
    tokens: { perModel: {}, costUsd: 0, costComplete: true },
  };
  const ref = { mainPath: 'F:\\x.jsonl', mtime: new Date(0), sizeBytes: 1 };
  const row = toSessionRow(report, ref, 2);
  assert.equal(row.sessionKind, 'headless');
  const back = toAnalysedSession({ ...row, reportJson: JSON.stringify(report) });
  assert.equal(back.sessionKind, 'headless');
});

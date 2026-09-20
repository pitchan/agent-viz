// Translation between the persisted row and the shape the rules consume.

import { expect, test } from 'vitest';
import { mainModelOf, toSessionRow, toAnalysedSession } from '../../src/server/observatory/session-mapper.ts';

type ScannedReport = Parameters<typeof mainModelOf>[0];
type TranscriptRef = Parameters<typeof toSessionRow>[1];

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
} as unknown as ScannedReport;
const ref = { mainPath: 'F:\\p\\s1.jsonl', mtime: new Date(1000), sizeBytes: 2048 } as unknown as TranscriptRef;

test('mainModelOf picks the model with the most net tokens', () => {
  expect(mainModelOf(report)).toBe('claude-opus-4-8');
});

test('mainModelOf returns null rather than an empty string when no model is known', () => {
  expect(mainModelOf({ ...report, tokens: { ...report.tokens, perModel: {} } })).toBe(null);
});

test('mainModelOf ranks on net tokens, cacheRead excluded', () => {
  const cacheHeavy = { ...report, tokens: { ...report.tokens, perModel: {
    a: { in: 1, out: 1, cacheCreate: 1, cacheRead: 999999 },
    b: { in: 50, out: 50, cacheCreate: 50, cacheRead: 0 },
  } } } as unknown as ScannedReport;
  expect(mainModelOf(cacheHeavy)).toBe('b');
});

test('toSessionRow carries the incremental key and serialises the report once', () => {
  const row = toSessionRow(report, ref, 7);
  expect(row.id).toBe('s1');
  expect(row.project).toBe('F--proj');
  expect(row.transcriptPath).toBe('F:\\p\\s1.jsonl');
  expect(row.fileMtime).toBe(1000);
  expect(row.fileSize).toBe(2048);
  expect(row.scanVersion).toBe(7);
  expect(row.modelMain).toBe('claude-opus-4-8');
  expect(row.costComplete).toBe(true);
  expect(JSON.parse(row.reportJson).sessionId).toBe('s1');
});

test('toAnalysedSession is the exact inverse for everything the rules read', () => {
  const analysed = toAnalysedSession(toSessionRow(report, ref, 1));
  expect({ id: analysed.id, project: analysed.project, startedAt: analysed.startedAt,
      endedAt: analysed.endedAt, netTokens: analysed.netTokens,
      costUsd: analysed.costUsd, costComplete: analysed.costComplete }).toEqual({ id: 's1', project: 'F--proj', startedAt: '2026-07-01T10:00:00.000Z',
      endedAt: '2026-07-01T10:20:00.000Z', netTokens: 1000, costUsd: 0.5, costComplete: true });
  expect((analysed.report as unknown as Record<string, unknown>).sessionId).toBe('s1');
});

test('toSessionRow carries the engine sessionKind and toAnalysedSession restores it', () => {
  const report = {
    sessionId: 's-kind', projectSlug: 'F--p', startedAt: null, endedAt: null,
    sessionKind: 'headless', netTokens: 1,
    tokens: { perModel: {}, costUsd: 0, costComplete: true },
  } as unknown as ScannedReport;
  const ref = { mainPath: 'F:\\x.jsonl', mtime: new Date(0), sizeBytes: 1 } as unknown as TranscriptRef;
  const row = toSessionRow(report, ref, 2);
  expect(row.sessionKind).toBe('headless');
  const back = toAnalysedSession({ ...row, reportJson: JSON.stringify(report) });
  expect(back.sessionKind).toBe('headless');
});

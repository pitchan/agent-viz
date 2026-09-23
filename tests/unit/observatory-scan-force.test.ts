// Une session inchangée sur disque est relue quand on la désigne : c'est ainsi qu'un
// prix adopté atteint les coûts déjà rangés.
import { expect, test } from 'vitest';
import { runIncrementalScan } from '../../src/server/observatory/scan.ts';
import { fakeReport, fakeRef } from '../helpers/observatory-fakes.ts';

function deps() {
  const scanned: string[] = [];
  return {
    scanned,
    deps: {
      engine: {
        discoverSessions: async () => [fakeRef('s1')],
        scanSession: async (ref: { sessionId: string }) => { scanned.push(ref.sessionId); return fakeReport(ref.sessionId); },
      },
      store: { needsScan: () => false, upsertSession: () => {}, setScanState: () => {} },
      broadcast: () => {},
      now: () => new Date('2026-07-15T12:00:00.000Z'),
    },
  };
}

test('une session à jour mais désignée est relue', async () => {
  // Arrange
  const h = deps();

  // Act
  await runIncrementalScan(h.deps, { claudeDir: 'x', forceIds: new Set(['s1']) });

  // Assert
  expect(h.scanned).toEqual(['s1']);
});

test('une session à jour et non désignée reste sautée', async () => {
  // Arrange
  const h = deps();

  // Act
  const out = await runIncrementalScan(h.deps, { claudeDir: 'x' });

  // Assert
  expect(out.skipped).toBe(1);
});

// service.setRecommendationStatus : le service séquence (horloge injectée,
// raison transmise telle quelle) — la validation vit à la route, la
// persistance au magasin.

import { expect, test } from 'vitest';
import { createObservatoryService } from '../../src/server/observatory/service.ts';

type ServiceDeps = Parameters<typeof createObservatoryService>[0];

test('la raison d’arbitrage voyage jusqu’au magasin avec l’horloge injectée', async () => {
  // Arrange
  let got: unknown;
  const service = createObservatoryService({
    store: {
      setRecommendationStatus: (id: number, status: string, now: string, reason?: string | null) => {
        got = { id, status, now, reason };
        return true;
      },
    },
    now: () => new Date('2026-08-18T10:00:00.000Z'),
  } as unknown as ServiceDeps);
  // Act
  const ok = await service.setRecommendationStatus(7, 'arbitrated', 'déjà pesé hors session');
  // Assert
  expect(ok).toBe(true);
  expect(got).toEqual({
    id: 7, status: 'arbitrated',
    now: '2026-08-18T10:00:00.000Z', reason: 'déjà pesé hors session',
  });
});

test('sans raison, le magasin reçoit null — jamais undefined', async () => {
  // Arrange
  let got: unknown;
  const service = createObservatoryService({
    store: {
      setRecommendationStatus: (id: number, status: string, now: string, reason?: string | null) => {
        got = { id, status, reason };
        return true;
      },
    },
    now: () => new Date('2026-08-18T10:00:00.000Z'),
  } as unknown as ServiceDeps);
  // Act
  await service.setRecommendationStatus(7, 'new');
  // Assert
  expect(got).toEqual({ id: 7, status: 'new', reason: null });
});

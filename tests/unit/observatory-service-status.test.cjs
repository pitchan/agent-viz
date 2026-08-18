'use strict';
// service.setRecommendationStatus : le service séquence (horloge injectée,
// raison transmise telle quelle) — la validation vit à la route, la
// persistance au magasin.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createObservatoryService } = require('../../src/server/observatory/service.ts');

test('la raison d’arbitrage voyage jusqu’au magasin avec l’horloge injectée', async () => {
  // Arrange
  let got;
  const service = createObservatoryService({
    store: {
      setRecommendationStatus: (id, status, now, reason) => {
        got = { id, status, now, reason };
        return true;
      },
    },
    now: () => new Date('2026-08-18T10:00:00.000Z'),
  });
  // Act
  const ok = await service.setRecommendationStatus(7, 'arbitrated', 'déjà pesé hors session');
  // Assert
  assert.equal(ok, true);
  assert.deepEqual(got, {
    id: 7, status: 'arbitrated',
    now: '2026-08-18T10:00:00.000Z', reason: 'déjà pesé hors session',
  });
});

test('sans raison, le magasin reçoit null — jamais undefined', async () => {
  // Arrange
  let got;
  const service = createObservatoryService({
    store: {
      setRecommendationStatus: (id, status, now, reason) => {
        got = { id, status, reason };
        return true;
      },
    },
    now: () => new Date('2026-08-18T10:00:00.000Z'),
  });
  // Act
  await service.setRecommendationStatus(7, 'new');
  // Assert
  assert.deepEqual(got, { id: 7, status: 'new', reason: null });
});

// La vigie se souvient de chaque dérive et de sa PREMIÈRE détection : c'est la date
// à partir de laquelle un tarif différent adopté s'applique.
import { afterEach, expect, test } from 'vitest';
import { driftFor, driftSnapshot, forgetDrift, recordDrifts } from '../../src/server/pricing.ts';
import type { Drift } from '../../src/server/pricing.ts';

const P = { input: 4e-6, output: 2e-5, cacheCreate: 5e-6, cacheRead: 2e-7 };
const drift = (over: Partial<Drift> = {}): Drift =>
  ({ model: 'claude-opus-5-5', kind: 'modele-nouveau', litellm: P, embedded: null, maxInput: 1_000_000, ...over });

afterEach(() => forgetDrift('claude-opus-5-5'));

test('une dérive revue garde sa date de première détection', () => {
  // Arrange
  recordDrifts({ checkedAt: '2026-09-22T00:00:00.000Z', drifts: [drift()] });
  recordDrifts({ checkedAt: '2026-09-23T00:00:00.000Z', drifts: [drift()] });

  // Act
  const d = driftFor('claude-opus-5-5');

  // Assert
  expect(d?.firstSeenAt).toBe('2026-09-22T00:00:00.000Z');
});

test('une dérive revue avec d’autres prix repart de sa nouvelle détection', () => {
  // Arrange
  recordDrifts({ checkedAt: '2026-09-22T00:00:00.000Z', drifts: [drift()] });
  recordDrifts({ checkedAt: '2026-09-23T00:00:00.000Z', drifts: [drift({ litellm: { ...P, input: 3e-6 } })] });

  // Act
  const d = driftFor('claude-opus-5-5');

  // Assert
  expect(d).toMatchObject({ firstSeenAt: '2026-09-23T00:00:00.000Z', litellm: { input: 3e-6 } });
});

test('une dérive absente du dernier rapport est oubliée', () => {
  // Arrange
  recordDrifts({ checkedAt: '2026-09-22T00:00:00.000Z', drifts: [drift()] });
  recordDrifts({ checkedAt: '2026-09-23T00:00:00.000Z', drifts: [] });

  // Act
  const d = driftFor('claude-opus-5-5');

  // Assert
  expect(d).toBeNull();
});

test('l’instantané porte la date du dernier passage et les dérives en cours', () => {
  // Arrange
  recordDrifts({ checkedAt: '2026-09-23T00:00:00.000Z', drifts: [drift()] });

  // Act
  const s = driftSnapshot();

  // Assert
  expect(s.checkedAt).toBe('2026-09-23T00:00:00.000Z');
  expect(s.drifts.map(d => d.model)).toEqual(['claude-opus-5-5']);
});

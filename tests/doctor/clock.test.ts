import { expect, test } from 'vitest';
import { SessionClock } from '../../src/engine/doctor/aggregators/clock.ts';

test('sans aucun horodatage, first et last valent null', () => {
  const clock = new SessionClock();
  clock.add(undefined);
  expect(clock.first()).toBeNull();
  expect(clock.last()).toBeNull();
});

test('un seul horodatage : first et last sont identiques', () => {
  const clock = new SessionClock();
  clock.add('2026-07-01T10:00:00.000Z');
  expect(clock.first()).toBe('2026-07-01T10:00:00.000Z');
  expect(clock.last()).toBe('2026-07-01T10:00:00.000Z');
});

test('ordre d’arrivée quelconque : first = le plus ancien, last = le plus récent', () => {
  const clock = new SessionClock();
  clock.add('2026-07-01T10:05:00.000Z');
  clock.add('2026-07-01T10:00:00.000Z');
  clock.add('2026-07-01T10:09:00.000Z');
  expect(clock.first()).toBe('2026-07-01T10:00:00.000Z');
  expect(clock.last()).toBe('2026-07-01T10:09:00.000Z');
});

test('un horodatage impossible à parser est ignoré, jamais fatal', () => {
  const clock = new SessionClock();
  clock.add('pas-une-date');
  clock.add('2026-07-01T10:00:00.000Z');
  expect(clock.first()).toBe('2026-07-01T10:00:00.000Z');
  expect(clock.last()).toBe('2026-07-01T10:00:00.000Z');
});

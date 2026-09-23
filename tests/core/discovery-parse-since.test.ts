// parseSince lit la fenêtre demandée en ligne de commande. Il ne touche à aucun
// disque : il ne partage donc pas l’arbre factice de discoverSessions.
import { expect, test } from 'vitest';
import { parseSince } from '../../src/engine/core/discovery.ts';

const now = new Date('2026-07-09T12:00:00Z');
test('7d et 30d relatifs à maintenant', () => {
  expect(parseSince('7d', now)).toEqual(new Date('2026-07-02T12:00:00Z'));
  expect(parseSince('30d', now)).toEqual(new Date('2026-06-09T12:00:00Z'));
});
test('date ISO acceptée telle quelle', () => {
  expect(parseSince('2026-07-01', now)).toEqual(new Date('2026-07-01T00:00:00.000Z'));
});
test('valeur invalide → throw', () => {
  expect(() => parseSince('demain', now)).toThrow();
});

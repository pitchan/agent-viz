// La mention d'un tarif adopté : sa source et le jour de l'adoption, rien pour la table embarquée.
import { expect, test } from 'vitest';
import { adoptionNote } from '../../src/web/observatory/format.ts';

test('un tarif appliqué nomme Anthropic et le jour', () =>
  expect(adoptionNote({ source: 'anthropic', adoptedAt: '2026-09-23T12:00:00.000Z', from: null })).toBe('tarif Anthropic appliqué le 2026-09-23'));

test('un tarif embarqué n’a pas de mention', () => expect(adoptionNote(null)).toBe(''));

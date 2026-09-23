// Ce que ce fichier protege : le nom de modele ecrit sous le titre d'un noeud Session
// ou Agent du graphe, tire des seaux de jetons.

import { expect, test } from 'vitest';
import { nodeModelLabel, type TokenBucket } from '../../src/web/viz-state.ts';

const jetons = (main: TokenBucket | null, agents: Record<string, TokenBucket> = {}) => ({
  main,
  perAgent: new Map(Object.entries(agents)),
});

test('un noeud Session porte le modele du fil principal', () => {
  // Arrange
  const t = jetons({ lastModel: 'claude-opus-5-5' }, { abc: { lastModel: 'claude-haiku-4-5' } });
  // Act
  const label = nodeModelLabel({ id: 's:fa9c8d45', type: 'session' }, t);
  // Assert
  expect(label).toBe('Opus 5.5');
});

test('un noeud Agent porte le modele de son propre seau', () => {
  // Arrange
  const t = jetons({ lastModel: 'claude-opus-5-5' }, { abc: { lastModel: 'claude-sonnet-5' } });
  // Act
  const label = nodeModelLabel({ id: 'a:abc', type: 'agent' }, t);
  // Assert
  expect(label).toBe('Sonnet 5');
});

test('un agent dont le seau n est pas encore arrive n affiche rien', () => {
  // Arrange
  const t = jetons({ lastModel: 'claude-opus-5-5' });
  // Act
  const label = nodeModelLabel({ id: 'a:abc', type: 'agent' }, t);
  // Assert
  expect(label).toBe('');
});

test('un seau sans modele connu n affiche rien', () => {
  // Arrange
  const t = jetons({ in: 10 });
  // Act
  const label = nodeModelLabel({ id: 's:fa9c8d45', type: 'session' }, t);
  // Assert
  expect(label).toBe('');
});

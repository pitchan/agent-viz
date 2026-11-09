// La ligne fermee des cartes, sur le texte que les regles emettent vraiment :
// la coupe ne doit ni perdre une valeur ni ne laisser qu'un mot vide.
import { expect, test } from 'vitest';
import { gestureHead } from '../../src/web/observatory/card-line.ts';
import * as r10 from '../../src/server/observatory/rules/r10-user-only-skill.ts';
import { SEE_ALSO_ACTION } from '../../src/server/observatory/rules/cross-links.ts';
import { listed, skillSession } from '../helpers/skill-sessions.ts';

test('la ligne fermee d une carte R10 garde la valeur « true » du reglage', () => {
  // Arrange
  const sessions = [
    skillSession('s1', { typed: { 'code-review': 3 }, listing: [listed('code-review', 853)] }),
  ];
  const [carte] = r10.evaluate({ sessions, configItems: [] });
  // Act
  const ligne = gestureHead(carte!.action);
  // Assert
  expect(ligne).toContain('disable-model-invocation: true');
});

test('la ligne fermee d un renvoi nomme la carte vers laquelle il renvoie', () => {
  // Arrange
  const action = SEE_ALSO_ACTION;
  // Act
  const ligne = gestureHead(action);
  // Assert
  expect(ligne).toBe('Voir aussi « MCP chargé mais rarement utilisé »');
});

// Le curseur de lecture de la page : ce que le direct a déjà montré n'est pas
// retraité par le rattrapage, qu'il vienne du retour sur l'onglet ou d'un poll.
import { expect, test } from 'vitest';
import { START, afterLiveEvent, catchUp } from '../../src/web/viz-event-cursor.ts';

const ligne = (i: number) => JSON.stringify({ hook_event_name: 'PreToolUse', tool_use_id: `t${i}`, command: 'écho' });
const octets = (texte: string) => new TextEncoder().encode(texte);
// Fin de la ligne i dans un fichier fait des lignes 0..i, en octets.
const fin = (i: number) => octets(Array.from({ length: i + 1 }, (_, k) => ligne(k) + '\n').join('')).length;
// Le corps de GET /events quand le serveur répond depuis la fin de la ligne `depuis`.
const corps = (depuis: number, jusqua: number) =>
  octets(Array.from({ length: jusqua - depuis }, (_, k) => ligne(depuis + 1 + k) + '\n').join(''));

test('apres un evenement recu en direct, le rattrapage repart de la fin de sa ligne', () => {
  // Arrange
  const direct = { offset: fin(3), layout: 0 };

  // Act
  const curseur = afterLiveEvent(START, direct);

  // Assert
  expect(curseur.offset).toBe(fin(3));
});

test('une ligne deja recue en direct n est pas retraitee par le rattrapage', () => {
  // Arrange — le direct a montré la ligne 3 pendant que la réponse partait de la fin de la ligne 2.
  const curseur = { offset: fin(3), layout: 0 };

  // Act
  const { lines } = catchUp(curseur, corps(2, 4), fin(4), 0);

  // Assert
  expect(lines).toEqual([ligne(4)]);
});

test('le curseur ne recule pas quand le direct a devance la reponse', () => {
  // Arrange
  const curseur = { offset: fin(5), layout: 0 };

  // Act
  const suite = catchUp(curseur, corps(2, 4), fin(4), 0);

  // Assert
  expect(suite.cursor).toEqual({ offset: fin(5), layout: 0 });
});

test('apres une compaction, le rattrapage traite toute sa reponse et adopte la nouvelle mise en page', () => {
  // Arrange — le serveur a déjà ramené le curseur dans la nouvelle mise en page.
  const curseur = { offset: fin(9), layout: 0 };

  // Act
  const suite = catchUp(curseur, corps(-1, 1), fin(1), 1);

  // Assert
  expect([suite.lines, suite.cursor]).toEqual([[ligne(0), ligne(1)], { offset: fin(1), layout: 1 }]);
});

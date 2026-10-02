// La première question d'une session Claude Code, telle que la liste des sessions l'affiche.
import { expect, test } from 'vitest';
import { extractPrompt } from '../../src/server/transcript-adapters/claude.ts';

const ligne = (o: unknown) => JSON.stringify(o);

test('une question écrite en texte simple est rendue telle quelle', () => {
  // Arrange
  const transcript = ligne({ type: 'user', message: { content: 'Corrige le test qui échoue' } });
  // Act
  const question = extractPrompt(transcript);
  // Assert
  expect(question).toBe('Corrige le test qui échoue');
});

test('une question en blocs rend le premier bloc de texte', () => {
  // Arrange
  const transcript = ligne({
    type: 'user',
    message: { content: [{ type: 'image' }, { type: 'text', text: 'Explique ce schéma' }] },
  });
  // Act
  const question = extractPrompt(transcript);
  // Assert
  expect(question).toBe('Explique ce schéma');
});

test('le bruit posé par l\'éditeur est sauté au profit de la vraie question', () => {
  // Arrange
  const transcript = [
    ligne({ type: 'user', message: { content: 'The user opened the file src/a.ts in the IDE.' } }),
    ligne({ type: 'user', message: { content: 'Ajoute un test pour ce cas' } }),
  ].join('\n');
  // Act
  const question = extractPrompt(transcript);
  // Assert
  expect(question).toBe('Ajoute un test pour ce cas');
});

test('les blocs balisés sont retirés de la question', () => {
  // Arrange
  const transcript = ligne({
    type: 'user',
    message: { content: '<system-reminder>rappel interne</system-reminder>Renomme cette fonction' },
  });
  // Act
  const question = extractPrompt(transcript);
  // Assert
  expect(question).toBe('Renomme cette fonction');
});

test('une question longue est coupée à 120 caractères', () => {
  // Arrange
  const transcript = ligne({ type: 'user', message: { content: 'a'.repeat(300) } });
  // Act
  const question = extractPrompt(transcript);
  // Assert
  expect(question).toBe('a'.repeat(120));
});

test('un bloc nul fait abandonner toute la ligne, la question vient de la suivante', () => {
  // Arrange
  const transcript = [
    ligne({ type: 'user', message: { content: [null, { type: 'text', text: 'Question de la ligne cassée' }] } }),
    ligne({ type: 'user', message: { content: 'Question de la ligne saine' } }),
  ].join('\n');
  // Act
  const question = extractPrompt(transcript);
  // Assert
  expect(question).toBe('Question de la ligne saine');
});

test('un transcript sans question d\'utilisateur ne rend rien', () => {
  // Arrange
  const transcript = ligne({ type: 'assistant', message: { content: 'Voici la réponse attendue' } });
  // Act
  const question = extractPrompt(transcript);
  // Assert
  expect(question).toBeNull();
});

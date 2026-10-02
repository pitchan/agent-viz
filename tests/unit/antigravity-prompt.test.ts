// La première question d'une session Antigravity, lue dans son transcript.
import { expect, test } from 'vitest';
import { extractPrompt } from '../../src/server/transcript-adapters/antigravity.ts';

// Forme relevée sur un transcript réel d'agy 1.2.13.
function entree(content: string, surcharge: Record<string, unknown> = {}): string {
  return JSON.stringify({
    step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', status: 'DONE',
    created_at: '2026-09-30T12:35:14Z', content, ...surcharge,
  });
}

test('la question est le texte entre les balises USER_REQUEST', () => {
  // Arrange
  const transcript = entree(
    '<USER_REQUEST>\nLis notes.txt, puis réponds ok.\n</USER_REQUEST>\n<ADDITIONAL_METADATA>\nThe current local time is…\n</ADDITIONAL_METADATA>',
  );
  // Act
  const question = extractPrompt(transcript);
  // Assert
  expect(question).toBe('Lis notes.txt, puis réponds ok.');
});

test('la question est trouvée même si sa ligne n\'est pas la première du fichier', () => {
  // Arrange — agy n'écrit pas ses lignes dans l'ordre des étapes
  const transcript = [
    JSON.stringify({ step_index: 2, source: 'MODEL', type: 'GENERIC', status: 'DONE', content: 'résultat' }),
    entree('<USER_REQUEST>\nListe les fichiers\n</USER_REQUEST>'),
  ].join('\n');
  // Act
  const question = extractPrompt(transcript);
  // Assert
  expect(question).toBe('Liste les fichiers');
});

test('une question longue est coupée à 120 caractères', () => {
  // Arrange
  const transcript = entree(`<USER_REQUEST>\n${'b'.repeat(300)}\n</USER_REQUEST>`);
  // Act
  const question = extractPrompt(transcript);
  // Assert
  expect(question).toBe('b'.repeat(120));
});

test('une entrée sans balises ne rend rien plutôt que son contenu brut', () => {
  // Arrange
  const transcript = entree('The current local time is 2026-09-30');
  // Act
  const question = extractPrompt(transcript);
  // Assert
  expect(question).toBeNull();
});

test('une réponse du modèle qui cite les balises n\'est pas prise pour la question', () => {
  // Arrange
  const transcript = entree('<USER_REQUEST>faux</USER_REQUEST>', { source: 'MODEL', type: 'PLANNER_RESPONSE' });
  // Act
  const question = extractPrompt(transcript);
  // Assert
  expect(question).toBeNull();
});

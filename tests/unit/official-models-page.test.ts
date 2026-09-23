// Le lecteur de la page des modèles d'Anthropic : la fenêtre de contexte par
// identifiant, seule donnée que la page des tarifs ne porte pas.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';
import { parseModelsPage } from '../../src/server/official-pricing.ts';

const PAGE = readFileSync(path.join(import.meta.dirname, '..', 'fixtures', 'anthropic-pricing', 'models-overview.md'), 'utf8');

test('la fenêtre de contexte se lit par identifiant', () => {
  // Arrange
  const page = PAGE;

  // Act
  const fenetres = parseModelsPage(page);

  // Assert
  expect(fenetres.get('claude-opus-5-5')).toBe(1_000_000);
});

test('un identifiant daté est ramené à sa forme canonique, « 200K » vaut 200 000', () => {
  // Arrange
  const page = PAGE;

  // Act
  const fenetres = parseModelsPage(page);

  // Assert
  expect(fenetres.get('claude-haiku-4-5')).toBe(200_000);
});

test('une page sans les lignes identifiant et fenêtre est une erreur nommée', () => {
  expect(() => parseModelsPage('# Models\n\nrien ici')).toThrow(/fenêtre de contexte/);
});

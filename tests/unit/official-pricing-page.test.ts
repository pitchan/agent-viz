// Le lecteur de la page des tarifs d'Anthropic : un relevé réel en entrée, les
// quatre tarifs par modèle en sortie. Une page qu'il ne sait plus lire est une
// erreur nommée, jamais une table vide.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';
import { parsePricingPage } from '../../src/server/official-pricing.ts';

const PAGE = readFileSync(path.join(import.meta.dirname, '..', 'fixtures', 'anthropic-pricing', 'pricing.md'), 'utf8');

test('un modèle se lit sous son identifiant, en dollars par jeton', () => {
  // Arrange
  const page = PAGE;

  // Act
  const prix = parsePricingPage(page);

  // Assert
  expect(prix.get('claude-opus-5-5')).toEqual({ input: 4e-6, output: 2e-5, cacheCreate: 5e-6, cacheRead: 2e-7 });
});

test('la mention entre parenthèses et la note en exposant ne gênent pas la lecture', () => {
  // Arrange
  const page = PAGE;

  // Act
  const prix = parsePricingPage(page);

  // Assert
  expect(prix.get('claude-mythos-5-1')).toEqual({ input: 1e-5, output: 5e-5, cacheCreate: 1.25e-5, cacheRead: 2.5e-7 });
});

test('seul le premier tableau compte : les prix du traitement par lots ne l’écrasent pas', () => {
  // Arrange
  const page = PAGE;

  // Act
  const prix = parsePricingPage(page);

  // Assert
  expect(prix.get('claude-sonnet-5')?.input).toBe(2e-6);
});

test('chaque ligne du tableau donne un modèle', () => {
  // Arrange
  const page = PAGE;

  // Act
  const prix = parsePricingPage(page);

  // Assert
  expect(prix.size).toBe(18);
});

test('une écriture de cache 1 h qui ne vaut pas 2 × l’entrée écarte le modèle : la formule ne saurait le chiffrer', () => {
  // Arrange
  const page = PAGE.replace('| $4 / MTok         | $5 / MTok       | $8 / MTok', '| $4 / MTok         | $5 / MTok       | $9 / MTok');

  // Act
  const prix = parsePricingPage(page);

  // Assert
  expect(prix.has('claude-opus-5-5')).toBe(false);
});

test('une page sans le tableau des tarifs est une erreur nommée', () => {
  expect(() => parsePricingPage('# Pricing\n\nrien ici')).toThrow(/tableau des tarifs/);
});

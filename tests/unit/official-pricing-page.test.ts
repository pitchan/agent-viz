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

const PAGE_PAR_LONGUEUR = [
  '## Model pricing',
  '',
  '| Model | Base input tokens | 5m cache writes | 1h cache writes | Cache hits and refreshes | Output tokens |',
  '| :-- | :-- | :-- | :-- | :-- | :-- |',
  '| Claude Haiku 5.5 (for prompts up to 100,000 tokens) | $0.10 / MTok | $0.125 / MTok | $0.20 / MTok | $0.01 / MTok | $0.50 / MTok |',
  '| Claude Haiku 5.5 (for prompts over 100,000 tokens) | $0.50 / MTok | $0.625 / MTok | $1 / MTok | $0.05 / MTok | $2.50 / MTok |',
].join('\n');

test('un modèle tarifé par longueur de prompt se lit à son tarif des prompts courts, sa ligne des prompts longs ne l’écrase pas', () => {
  // Arrange
  const page = PAGE_PAR_LONGUEUR;

  // Act
  const prix = parsePricingPage(page);

  // Assert
  expect(prix.get('claude-haiku-5-5')).toEqual({ input: 1e-7, output: 5e-7, cacheCreate: 1.25e-7, cacheRead: 1e-8 });
});

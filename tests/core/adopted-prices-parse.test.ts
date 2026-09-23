// La forme du fichier des prix adoptés : une entrée hors forme est refusée avec sa raison,
// jamais ignorée en silence.
import { expect, test } from 'vitest';
import { parseAdoptedPrices } from '../../src/engine/core/adopted-prices.ts';

const P = { input: 4e-6, output: 2e-5, cacheCreate: 5e-6, cacheRead: 2e-7 };
const entree = (over: Record<string, unknown> = {}) => ({
  prices: P, maxInput: 1_000_000, from: null, replaces: null,
  adoptedAt: '2026-09-23T10:00:00.000Z', source: 'anthropic', ...over,
});

test('un fichier bien formé est rendu tel quel', () => {
  // Arrange
  const json = { 'claude-opus-5-5': [entree()] };

  // Act
  const r = parseAdoptedPrices(json, 'prices.json');

  // Assert
  expect(r['claude-opus-5-5']?.[0]?.prices).toEqual(P);
});

test('un prix négatif est refusé en nommant le modèle', () => {
  // Arrange
  const json = { 'claude-opus-5-5': [entree({ prices: { ...P, input: -1 } })] };

  // Act
  const act = () => parseAdoptedPrices(json, 'prices.json');

  // Assert
  expect(act).toThrow(/prices\.json : claude-opus-5-5\[0\]/);
});

test('`from` et `replaces` vont ensemble : l’un sans l’autre est refusé', () => {
  // Arrange
  const json = { 'claude-opus-5': [entree({ from: '2026-09-20T00:00:00.000Z' })] };

  // Act
  const act = () => parseAdoptedPrices(json, 'prices.json');

  // Assert
  expect(act).toThrow(/from et replaces/);
});

test('une clé réservée d’objet est refusée', () => {
  // Arrange
  const json: unknown = JSON.parse('{"__proto__": []}');

  // Act
  const act = () => parseAdoptedPrices(json, 'prices.json');

  // Assert
  expect(act).toThrow(/__proto__/);
});

test('une racine qui n’est pas un objet est refusée', () => {
  expect(() => parseAdoptedPrices([], 'prices.json')).toThrow(/objet/);
});

// Lire le fichier : absent = aucune adoption (état normal) ; toute autre panne remonte.
import { expect, test } from 'vitest';
import { readAdoptedPrices } from '../../src/engine/core/adopted-prices.ts';

test('un fichier absent rend une table d’adoptions vide', async () => {
  // Arrange
  const readFile = async (): Promise<string> => { throw Object.assign(new Error('absent'), { code: 'ENOENT' }); };

  // Act
  const r = await readAdoptedPrices('x/prices.json', readFile);

  // Assert
  expect(r).toEqual({});
});

test('une autre panne de lecture remonte', async () => {
  // Arrange
  const readFile = async (): Promise<string> => { throw Object.assign(new Error('refus'), { code: 'EACCES' }); };

  // Act
  const act = readAdoptedPrices('x/prices.json', readFile);

  // Assert
  await expect(act).rejects.toThrow('refus');
});

test('un JSON invalide remonte en nommant le fichier', async () => {
  // Arrange
  const readFile = async (): Promise<string> => '{pas du json';

  // Act
  const act = readAdoptedPrices('x/prices.json', readFile);

  // Assert
  await expect(act).rejects.toThrow(/x\/prices\.json/);
});

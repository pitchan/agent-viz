import { expect, test } from 'vitest';
import { skillCostCellOf, splitByUse, unusedTitle, usageCellOf, usageTitleOf } from '../../src/web/observatory/skills-view.ts';

test("la cellule d'usage montre le pourcentage arrondi à l'unité", () => {
  expect(usageCellOf({ usedShare: 34 / 103 })).toBe('33 %');
});

test('un skill utilisé moins d’une fois sur deux cents se lit « < 1 % », jamais 0 %', () => {
  expect(usageCellOf({ usedShare: 1 / 250 })).toBe('< 1 %');
});

test('un skill jamais utilisé se lit « 0 % »', () => {
  expect(usageCellOf({ usedShare: 0 })).toBe('0 %');
});

test("l'infobulle d'usage garde le décompte des sessions", () => {
  expect(usageTitleOf({ usedSessions: 34, offeredSessions: 103 })).toBe('34 sessions sur 103 où il était proposé');
});

test('un coût inconnu se lit « tarif inconnu », jamais 0', () => {
  expect(skillCostCellOf({ usedSessions: 1, usd: null })).toBe('tarif inconnu');
});

test('un coût connu passe par le format monétaire du panneau des tarifs', () => {
  expect(skillCostCellOf({ usedSessions: 1, usd: 0.001 })).toBe('< 0,01 $');
});

test("un skill jamais utilisé n'a rien d'attribué : « — »", () => {
  expect(skillCostCellOf({ usedSessions: 0, usd: 0 })).toBe('—');
});

test('les skills jamais utilisés sont séparés des autres, chacun gardant son ordre', () => {
  // Arrange
  const rows = [
    { skill: 'a', usedSessions: 2 }, { skill: 'b', usedSessions: 0 },
    { skill: 'c', usedSessions: 1 }, { skill: 'd', usedSessions: 0 },
  ];
  // Act
  const { used, unused } = splitByUse(rows);
  // Assert
  expect([used.map(r => r.skill), unused.map(r => r.skill)]).toEqual([['a', 'c'], ['b', 'd']]);
});

test('le titre du bloc à déplier porte le nombre de skills jamais utilisés', () => {
  expect(unusedTitle(70)).toBe('Jamais utilisés (70)');
});

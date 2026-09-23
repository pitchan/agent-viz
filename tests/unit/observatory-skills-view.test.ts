import { expect, test } from 'vitest';
import { excludedNote, projectOptionsOf, readCountLabel, splitByUse, unusedTitle, usageCellOf, usageTitleOf } from '../../src/web/observatory/skills-view.ts';

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
  expect(usageTitleOf({ usedSessions: 34, offeredSessions: 103 })).toBe('34 session(s) sur 103 où il était proposé');
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

test("la note des sessions écartées ne promet aucune ré-analyse : elle ne dit que le fait certain", () => {
  expect(excludedNote(3)).toBe(
    "3 session(s) de la période n'ont pas de données Skills (analysées par une version antérieure) — exclues du tableau.");
});

test('le menu des projets ouvre sur « Tous les projets », puis les projets tels que le serveur les classe', () => {
  // Arrange
  const projects = [
    { project: 'F--a', label: 'F:/a', sessions: 72 },
    { project: 'F--b', label: 'F:/b', sessions: 3 },
  ];
  // Act
  const options = projectOptionsOf(projects, 'F--b');
  // Assert
  expect(options).toEqual([
    { value: '', label: 'Tous les projets', selected: false },
    { value: 'F--a', label: 'F:/a (72)', selected: false },
    { value: 'F--b', label: 'F:/b (3)', selected: true },
  ]);
});

test('sans projet choisi, « Tous les projets » est la ligne retenue', () => {
  // Arrange
  const projects = [{ project: 'F--a', label: 'F:/a', sessions: 2 }];
  // Act
  const options = projectOptionsOf(projects, null);
  // Assert
  expect(options[0]).toEqual({ value: '', label: 'Tous les projets', selected: true });
});

test('sans projet choisi, le décompte lu ne mentionne pas de projet', () => {
  // Arrange
  const sessionsCounted = 8;
  // Act
  const label = readCountLabel(sessionsCounted, null);
  // Assert
  expect(label).toBe('8 session(s) lue(s)');
});

test('un projet choisi, le décompte lu précise qu’il ne porte que sur ce projet', () => {
  // Arrange
  const sessionsCounted = 3;
  // Act
  const label = readCountLabel(sessionsCounted, 'F--proj');
  // Assert
  expect(label).toBe('3 session(s) lue(s) pour ce projet');
});

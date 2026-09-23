// Per-skill usage over a window: offered = listed ∪ used, used = called ∪ marked
// by Claude Code. Usage only — a skill's cost is never computed.

import { expect, test } from 'vitest';
import { computeSkillUsage } from '../../src/server/observatory/skill-usage.ts';
import type { Session } from '../../src/server/observatory/rules/types.ts';

interface SessionOpts {
  listed?: string[];
  calls?: Record<string, number>;
  attributed?: string[];
  project?: string;
  cwd?: string;
}
function session({ listed = [], calls = {}, attributed = [], project = 'F--proj', cwd }: SessionOpts = {}): Session {
  return {
    id: 's', project,
    report: { skills: { listed, calls, attributed }, tokens: {}, ...(cwd !== undefined ? { cwd } : {}) },
  } as unknown as Session;
}
const beforeV11 = (project = 'F--proj'): Session =>
  ({ id: 'old', project, report: { tokens: {} } }) as unknown as Session;

test('le pourcentage vaut sessions où le skill a servi ÷ sessions où il était proposé', () => {
  // Arrange
  const sessions = [
    session({ listed: ['pptx', 'docx'], calls: { pptx: 1 } }),
    session({ listed: ['pptx', 'docx'] }),
  ];
  // Act
  const r = computeSkillUsage(sessions);
  // Assert
  expect(r.skills.find(s => s.skill === 'pptx')).toMatchObject({ offeredSessions: 2, usedSessions: 1, usedShare: 0.5 });
});

test('un skill marqué par Claude Code sans appel Skill compte comme utilisé', () => {
  // Arrange — lancé par une commande slash : aucun appel de l'outil Skill
  const sessions = [session({ listed: ['pptx'], attributed: ['pptx'] })];
  // Act
  const r = computeSkillUsage(sessions);
  // Assert
  expect(r.skills[0]).toMatchObject({ skill: 'pptx', usedSessions: 1 });
});

test('appelé et marqué dans la même session, le skill compte une seule session', () => {
  // Arrange
  const sessions = [session({ listed: ['pptx'], calls: { pptx: 2 }, attributed: ['pptx'] })];
  // Act
  const r = computeSkillUsage(sessions);
  // Assert
  expect(r.skills[0]).toMatchObject({ offeredSessions: 1, usedSessions: 1 });
});

test('un skill appelé hors listing compte comme proposé', () => {
  // Arrange
  const sessions = [session({ listed: [], calls: { pptx: 1 } })];
  // Act
  const r = computeSkillUsage(sessions);
  // Assert
  expect(r.skills[0]).toMatchObject({ skill: 'pptx', offeredSessions: 1, usedSessions: 1 });
});

test("une ligne ne porte que l'usage : aucun coût, aucun jeton", () => {
  // Arrange
  const sessions = [session({ listed: ['pptx'], calls: { pptx: 1 }, attributed: ['pptx'] })];
  // Act
  const r = computeSkillUsage(sessions);
  // Assert
  expect(Object.keys(r.skills[0]!).sort()).toEqual(['offeredSessions', 'skill', 'usedSessions', 'usedShare']);
});

test("les lignes vont par pourcentage d'utilisation décroissant", () => {
  // Arrange
  const sessions = [
    session({ listed: ['a', 'b', 'c'], calls: { a: 1, b: 1 } }),
    session({ listed: ['a', 'b', 'c'], calls: { b: 1, c: 1 } }),
    session({ listed: ['a', 'b'] }),
  ];
  // Act
  const r = computeSkillUsage(sessions);
  // Assert — b 2/3, c 1/2, a 1/3
  expect(r.skills.map(s => s.skill)).toEqual(['b', 'c', 'a']);
});

test("à pourcentage égal, le skill utilisé dans le plus de sessions passe d'abord", () => {
  // Arrange
  const sessions = [
    session({ listed: ['z', 'a'], calls: { z: 1, a: 1 } }),
    session({ listed: ['z', 'a'], calls: { z: 1 } }),
    session({ listed: ['z'] }),
    session({ listed: ['z'] }),
  ];
  // Act
  const r = computeSkillUsage(sessions);
  // Assert — z 2/4 et a 1/2 : même 50 %, z a servi dans plus de sessions
  expect(r.skills.map(s => s.skill)).toEqual(['z', 'a']);
});

test('les skills jamais utilisés restent dans le tableau à 0 %, en fin de liste, les plus proposés en tête', () => {
  // Arrange
  const sessions = [
    session({ listed: ['pptx', 'seo', 'docx'], calls: { pptx: 1 } }),
    session({ listed: ['docx'] }),
  ];
  // Act
  const r = computeSkillUsage(sessions);
  // Assert — docx proposé 2 fois, seo 1 fois
  expect(r.skills.map(s => [s.skill, s.usedShare])).toEqual([['pptx', 1], ['docx', 0], ['seo', 0]]);
});

test('une session scannée avant la version 12 est écartée et comptée', () => {
  // Arrange
  const sessions = [session({ listed: ['pptx'], calls: { pptx: 1 } }), beforeV11()];
  // Act
  const r = computeSkillUsage(sessions);
  // Assert
  expect(r).toMatchObject({ sessionsCounted: 1, excludedPendingRescan: 1 });
});

test('le filtre par projet ne compte que les sessions de ce projet', () => {
  // Arrange
  const sessions = [
    session({ project: 'A', listed: ['pptx'], calls: { pptx: 1 } }),
    session({ project: 'B', listed: ['pptx'] }),
    session({ project: 'B', listed: ['pptx'] }),
  ];
  // Act
  const r = computeSkillUsage(sessions, 'A');
  // Assert
  expect(r.sessionsCounted).toBe(1);
  expect(r.skills[0]).toMatchObject({ skill: 'pptx', offeredSessions: 1, usedSessions: 1, usedShare: 1 });
});

test('la liste des projets reste celle de la fenêtre entière, même quand on filtre', () => {
  // Arrange
  const sessions = [
    session({ project: 'A', listed: ['pptx'], calls: { pptx: 1 } }),
    session({ project: 'B', listed: ['pptx'] }),
    session({ project: 'B', listed: ['pptx'] }),
  ];
  // Act
  const r = computeSkillUsage(sessions, 'A');
  // Assert — B d'abord : deux sessions lues contre une
  expect(r.projects).toEqual([
    { project: 'B', label: 'B', sessions: 2 },
    { project: 'A', label: 'A', sessions: 1 },
  ]);
});

test('le libellé est le chemin réel quand le transcript le porte', () => {
  // Arrange
  const sessions = [session({ project: 'f--DEV-agent-viz', cwd: 'f:/DEV/agent-viz', listed: ['pptx'] })];
  // Act
  const r = computeSkillUsage(sessions);
  // Assert
  expect(r.projects[0]).toEqual({ project: 'f--DEV-agent-viz', label: 'F:/DEV/agent-viz', sessions: 1 });
});

test('un projet choisi sans session lue dans la fenêtre reste dans la liste, à zéro', () => {
  // Arrange
  const sessions = [session({ project: 'A', listed: ['pptx'] })];
  // Act
  const r = computeSkillUsage(sessions, 'B');
  // Assert
  expect(r.sessionsCounted).toBe(0);
  expect(r.projects).toContainEqual({ project: 'B', label: 'B', sessions: 0 });
});

test('les sessions écartées suivent le filtre : celles des autres projets ne comptent pas', () => {
  // Arrange
  const sessions = [
    session({ project: 'A', listed: ['pptx'], calls: { pptx: 1 } }),
    beforeV11('A'),
    beforeV11('B'),
  ];
  // Act
  const r = computeSkillUsage(sessions, 'A');
  // Assert
  expect(r).toMatchObject({ sessionsCounted: 1, excludedPendingRescan: 1 });
});

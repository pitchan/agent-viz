// Per-skill usage over a window: offered = listed ∪ called ∪ attributed,
// dollars summed from the engine's per-message cost, never recomputed.

import { expect, test } from 'vitest';
import { computeSkillUsage } from '../../src/server/observatory/skill-usage.ts';
import type { Session, SkillCost, TokenBucket } from '../../src/server/observatory/rules/types.ts';

const bucket = (inTok: number): TokenBucket =>
  ({ in: inTok, out: 0, cacheCreate: 0, cacheRead: 0, cacheCreate1h: 0, cacheCreate5m: 0 });
const cost = (inTok: number, usd: number | null): SkillCost => ({ tokens: bucket(inTok), usd });

interface SessionOpts {
  costUsd?: number;
  listed?: string[];
  calls?: Record<string, number>;
  costBySkill?: Record<string, SkillCost>;
}
function session({ costUsd = 1, listed = [], calls = {}, costBySkill = {} }: SessionOpts = {}): Session {
  return { id: 's', costUsd, report: { skills: { listed, calls }, tokens: { costBySkill } } } as unknown as Session;
}
const beforeV11 = (): Session => ({ id: 'old', costUsd: 1, report: { tokens: {} } }) as unknown as Session;

test('le pourcentage vaut sessions où le skill a servi ÷ sessions où il était proposé', () => {
  // Arrange
  const sessions = [
    session({ listed: ['pptx', 'docx'], calls: { pptx: 1 } }),
    session({ listed: ['pptx', 'docx'] }),
  ];
  // Act
  const r = computeSkillUsage(sessions);
  // Assert
  expect(r.skills.find(s => s.skill === 'pptx')).toMatchObject({ offeredSessions: 2, usedSessions: 1, usedShare: 0.5, calls: 1 });
});

test('un skill attribué sans appel compte comme utilisé', () => {
  // Arrange
  const sessions = [session({ listed: ['pptx'], costBySkill: { pptx: cost(10, 0.1) } })];
  // Act
  const r = computeSkillUsage(sessions);
  // Assert
  expect(r.skills[0]).toMatchObject({ skill: 'pptx', usedSessions: 1, calls: 0 });
});

test('un skill appelé hors listing compte comme proposé', () => {
  // Arrange
  const sessions = [session({ listed: [], calls: { pptx: 1 } })];
  // Act
  const r = computeSkillUsage(sessions);
  // Assert
  expect(r.skills[0]).toMatchObject({ skill: 'pptx', offeredSessions: 1, usedSessions: 1 });
});

test('jetons et dollars attribués se cumulent entre sessions, avec leur part du coût', () => {
  // Arrange
  const sessions = [
    session({ costUsd: 2, listed: ['pptx'], costBySkill: { pptx: cost(100, 0.5) } }),
    session({ costUsd: 2, listed: ['pptx'], costBySkill: { pptx: cost(50, 0.5) } }),
  ];
  // Act
  const r = computeSkillUsage(sessions);
  // Assert
  expect(r.skills[0]).toMatchObject({ netTokens: 150, usd: 1, shareOfCost: 0.25 });
});

test('un tarif inconnu dans une session rend le skill null, sans part du coût', () => {
  // Arrange
  const sessions = [
    session({ listed: ['pptx'], costBySkill: { pptx: cost(100, 0.5) } }),
    session({ listed: ['pptx'], costBySkill: { pptx: cost(50, null) } }),
  ];
  // Act
  const r = computeSkillUsage(sessions);
  // Assert
  expect(r.skills[0]).toMatchObject({ usd: null, shareOfCost: null });
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

test('une session scannée avant la version 11 est écartée et comptée', () => {
  // Arrange
  const sessions = [session({ listed: ['pptx'], calls: { pptx: 1 } }), beforeV11()];
  // Act
  const r = computeSkillUsage(sessions);
  // Assert
  expect(r).toMatchObject({ sessionsCounted: 1, excludedPendingRescan: 1 });
});

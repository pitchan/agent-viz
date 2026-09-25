// Tri commun des quatre règles de skills : une session sans les faits récents est écartée et comptée.
import { expect, test } from 'vitest';
import { baseName, splitBySkillFacts } from '../../src/server/observatory/rules/skill-facts.ts';
import { skillSession } from '../helpers/skill-sessions.ts';

test('une session stockée avant les faits de liste est écartée et comptée', () => {
  // Arrange
  const sessions = [skillSession('s1', {}), skillSession('s2', null)];
  // Act
  const { ready, excludedPendingRescan } = splitBySkillFacts(sessions);
  // Assert
  expect(ready.map(s => s.id)).toEqual(['s1']);
  expect(excludedPendingRescan).toBe(1);
});

test('le nom de base retire le préfixe de plugin', () => {
  // Arrange / Act / Assert
  expect(baseName('anthropic-skills:docx')).toBe('docx');
  expect(baseName('skill-creator:skill-creator')).toBe('skill-creator');
  expect(baseName('docx')).toBe('docx');
});

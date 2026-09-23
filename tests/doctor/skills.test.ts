import { expect, test } from 'vitest';
import { SkillsAggregator } from '../../src/engine/doctor/aggregators/skills.ts';

const skillCall = (id: string, skill: unknown) => ({ id, name: 'Skill', input: { skill } });

test('les noms de plusieurs listings sont réunis, sans doublon, triés', () => {
  // Arrange
  const agg = new SkillsAggregator();
  // Act
  agg.addListing({ kind: 'skill_listing', names: ['pptx', 'docx'] });
  agg.addListing({ kind: 'skill_listing', names: ['docx', 'anthropic-skills:xlsx'] });
  // Assert
  expect(agg.result().listed).toEqual(['anthropic-skills:xlsx', 'docx', 'pptx']);
});

test('un appel Skill compte une fois par identifiant, même répété', () => {
  // Arrange
  const agg = new SkillsAggregator();
  // Act
  agg.addToolUse(skillCall('tu1', 'pptx'));
  agg.addToolUse(skillCall('tu1', 'pptx'));
  agg.addToolUse(skillCall('tu2', 'pptx'));
  // Assert
  expect(agg.result().calls).toEqual({ pptx: 2 });
});

test('un autre outil, ou un Skill sans nom exploitable, ne compte pas', () => {
  // Arrange
  const agg = new SkillsAggregator();
  // Act
  agg.addToolUse({ id: 'tu1', name: 'Bash', input: { skill: 'pptx' } });
  agg.addToolUse(skillCall('tu2', 42));
  agg.addToolUse(skillCall('tu3', ''));
  agg.addToolUse({ id: 'tu4', name: 'Skill', input: null });
  // Assert
  expect(agg.result().calls).toEqual({});
});

test("un appel hors listing est compté sans modifier la liste : c'est un fait brut", () => {
  // Arrange
  const agg = new SkillsAggregator();
  // Act
  agg.addToolUse(skillCall('tu1', 'pptx'));
  // Assert
  expect(agg.result()).toEqual({ listed: [], calls: { pptx: 1 }, attributed: [] });
});

test('les skills que Claude Code marque sur les messages sont réunis, sans doublon, triés', () => {
  // Arrange
  const agg = new SkillsAggregator();
  // Act
  agg.addAssistant({ attributionSkill: 'pptx' });
  agg.addAssistant({ attributionSkill: 'pptx' });
  agg.addAssistant({ attributionSkill: 'docx' });
  agg.addAssistant({});
  // Assert
  expect(agg.result().attributed).toEqual(['docx', 'pptx']);
});

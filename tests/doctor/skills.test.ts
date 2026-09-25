import { expect, test } from 'vitest';
import { SkillsAggregator } from '../../src/engine/doctor/aggregators/skills.ts';

const skillCall = (id: string, skill: unknown) => ({ id, name: 'Skill', input: { skill } });

test('les noms de plusieurs listings sont réunis, sans doublon, triés', () => {
  // Arrange
  const agg = new SkillsAggregator();
  // Act
  agg.addListing({ kind: 'skill_listing', names: ['pptx', 'docx'], entries: [] });
  agg.addListing({ kind: 'skill_listing', names: ['docx', 'anthropic-skills:xlsx'], entries: [] });
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
  expect(agg.result()).toEqual({ listed: [], calls: { pptx: 1 }, attributed: [],
    listing: [], typed: {}, bodies: [], unattributedBodies: 0 });
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

const entry = (name: string, chars: number, hasDescription = true) => ({ name, chars, hasDescription });
const body = (sourceToolUseId: string | null, lines = 600, bytes = 30000) =>
  ({ kind: 'skill_body' as const, lines, bytes, sourceToolUseId });

test('la dernière entrée vue par nom est gardée, triée par nom', () => {
  // Arrange
  const agg = new SkillsAggregator();
  // Act
  agg.addListing({ kind: 'skill_listing', names: ['pptx', 'docx'], entries: [entry('pptx', 40), entry('docx', 30)] });
  agg.addListing({ kind: 'skill_listing', names: ['pptx'], entries: [entry('pptx', 6, false)] });
  // Assert
  expect(agg.result().listing).toEqual([entry('docx', 30), entry('pptx', 6, false)]);
});

test('une commande tapée est comptée par nom', () => {
  // Arrange
  const agg = new SkillsAggregator();
  // Act
  agg.addPrompt({ commandName: 'pptx' });
  agg.addPrompt({ commandName: 'pptx' });
  agg.addPrompt({});
  // Assert
  expect(agg.result().typed).toEqual({ pptx: 2 });
});

test("un texte chargé se rattache à l'appel Skill désigné par son sourceToolUseId", () => {
  // Arrange
  const agg = new SkillsAggregator();
  agg.addToolUse(skillCall('tu1', 'pptx'));
  // Act
  agg.addBody(body('tu1'), 'main');
  // Assert
  expect(agg.result().bodies).toEqual([{ skill: 'pptx', lines: 600, bytes: 30000, by: 'model' }]);
});

test('un texte sans sourceToolUseId se rattache à la commande tapée juste avant, une seule fois', () => {
  // Arrange
  const agg = new SkillsAggregator();
  agg.addPrompt({ commandName: 'docx' });
  // Act
  agg.addBody(body(null), 'main');
  agg.addBody(body(null), 'main');
  // Assert
  expect(agg.result().bodies).toEqual([{ skill: 'docx', lines: 600, bytes: 30000, by: 'user' }]);
  expect(agg.result().unattributedBodies).toBe(1);
});

test('un prompt ordinaire entre la commande et le texte coupe le rattachement', () => {
  // Arrange
  const agg = new SkillsAggregator();
  agg.addPrompt({ commandName: 'docx' });
  agg.addPrompt({});
  // Act
  agg.addBody(body(null), 'main');
  // Assert
  expect(agg.result().bodies).toEqual([]);
  expect(agg.result().unattributedBodies).toBe(1);
});

test('un sourceToolUseId inconnu est compté comme non rattaché', () => {
  // Arrange
  const agg = new SkillsAggregator();
  // Act
  agg.addBody(body('tu-inconnu'), 'main');
  // Assert
  expect(agg.result().unattributedBodies).toBe(1);
});

test("un texte sans sourceToolUseId dans un sous-agent ne se rattache jamais à une commande tapée", () => {
  // Arrange
  const agg = new SkillsAggregator();
  agg.addPrompt({ commandName: 'docx' });
  // Act
  agg.addBody(body(null), 'agent-x');
  // Assert
  expect(agg.result().bodies).toEqual([]);
  expect(agg.result().unattributedBodies).toBe(1);
});

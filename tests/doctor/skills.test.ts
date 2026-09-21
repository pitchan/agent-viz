import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { discoverSessions } from '../../src/engine/core/discovery.ts';
import { SkillsAggregator } from '../../src/engine/doctor/aggregators/skills.ts';
import { scanSession } from '../../src/engine/doctor/scan-session.ts';
import {
  assistantLine, promptLine, skillListingLine, toolResultLine, toolUse, writeSessionTree,
} from '../helpers/build-transcript.ts';

const skillCall = (id: string, skill: unknown) => ({ id, name: 'Skill', input: { skill } });

describe('SkillsAggregator', () => {
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
    expect(agg.result()).toEqual({ listed: [], calls: { pptx: 1 } });
  });
});

const USAGE = { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };

describe('scanSession — les faits de skills', () => {
  const claudeDir = mkdtempSync(path.join(tmpdir(), 'netgain-skills-'));
  afterAll(() => rmSync(claudeDir, { recursive: true, force: true }));

  test("listing, appel, et messages attribués du principal et d'un sous-agent", async () => {
    // Arrange
    writeSessionTree(claudeDir, 'F--skills', 'sess-skills', [
      skillListingLine(['pptx', 'docx']),
      promptLine('fais un deck', { timestamp: '2026-09-01T10:00:00.000Z' }),
      assistantLine({ msgId: 'm1', model: 'claude-opus-4-8', usage: USAGE,
        content: [toolUse('tu1', 'Skill', { skill: 'pptx' })], timestamp: '2026-09-01T10:00:01.000Z' }),
      toolResultLine('tu1', 'Launching skill: pptx', { timestamp: '2026-09-01T10:00:02.000Z' }),
      assistantLine({ msgId: 'm2', model: 'claude-opus-4-8', usage: USAGE, attributionSkill: 'pptx',
        timestamp: '2026-09-01T10:00:03.000Z' }),
    ], [{ agentId: 'aaa', lines: [
      assistantLine({ msgId: 's1', model: 'claude-opus-4-8', usage: USAGE, attributionSkill: 'pptx',
        isSidechain: true, timestamp: '2026-09-01T10:00:04.000Z' }),
    ] }]);
    const refs = await discoverSessions(claudeDir, { project: 'F--skills' });
    // Act
    const r = await scanSession(refs[0]!, 100);
    // Assert
    expect(r.skills).toEqual({ listed: ['docx', 'pptx'], calls: { pptx: 1 } });
    expect(r.tokens.costBySkill['pptx']?.tokens.in).toBe(20);
  });
});

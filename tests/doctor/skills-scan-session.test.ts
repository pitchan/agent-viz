// Les faits de skills que scanSession rend, lus de bout en bout sur un transcript
// écrit dans un dossier temporaire.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, expect, test } from 'vitest';
import { embeddedPricing } from '../../src/engine/core/pricing.ts';
import { discoverSessions } from '../../src/engine/core/discovery.ts';
import { scanSession } from '../../src/engine/doctor/scan-session.ts';
import { assistantLine, promptLine, skillListingLine, toolResultLine, toolUse, writeSessionTree } from '../helpers/build-transcript.ts';

const USAGE = { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };

const claudeDir = mkdtempSync(path.join(tmpdir(), 'netgain-skills-'));
afterAll(() => rmSync(claudeDir, { recursive: true, force: true }));

test("listing, appel, et skill marqué dans le principal et un sous-agent — aucun coût par skill", async () => {
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
  const r = await scanSession(refs[0]!, 100, embeddedPricing);
  // Assert
  expect(r.skills).toEqual({ listed: ['docx', 'pptx'], calls: { pptx: 1 }, attributed: ['pptx'] });
  expect(r.tokens).not.toHaveProperty('costBySkill');
});

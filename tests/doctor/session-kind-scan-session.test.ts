// La forme de session que scanSession rend, lue de bout en bout sur un transcript
// écrit dans un dossier temporaire.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, expect, test } from 'vitest';
import { embeddedPricing } from '../../src/engine/core/pricing.ts';
import { discoverSessions } from '../../src/engine/core/discovery.ts';
import { scanSession } from '../../src/engine/doctor/scan-session.ts';
import { assistantLine, promptBlocksLine, promptLine, writeSessionTree } from '../helpers/build-transcript.ts';

const claudeDir = mkdtempSync(path.join(tmpdir(), 'netgain-kind-'));
afterAll(() => rmSync(claudeDir, { recursive: true, force: true }));

async function reportOf(project: string, sessionId: string) {
  const refs = await discoverSessions(claudeDir, { project });
  const ref = refs.find((r) => r.sessionId === sessionId);
  expect(ref).toBeDefined();
  return scanSession(ref!, 100, embeddedPricing);
}

test('prompts en blocs → interactive', async () => {
  writeSessionTree(claudeDir, 'F--kind-inter', 'sess-inter', [
    promptBlocksLine('analyse le projet', { timestamp: '2026-07-01T10:00:00.000Z', cwd: 'F:\\kind-inter' }),
    assistantLine({ msgId: 'm1', model: 'claude-opus-4-8', usage: { input_tokens: 10, output_tokens: 5 } }),
  ]);
  expect((await reportOf('kind-inter', 'sess-inter')).sessionKind).toBe('interactive');
});

test('session CLI humaine (chaîne + marqueurs de saisie) → interactive', async () => {
  writeSessionTree(claudeDir, 'F--kind-cli-human', 'sess-cli-human', [
    promptLine('fais X', { promptSource: 'typed', origin: { kind: 'human' } }),
    assistantLine({ msgId: 'm1', model: 'claude-opus-4-8', usage: { input_tokens: 10, output_tokens: 5 } }),
  ]);
  expect((await reportOf('kind-cli-human', 'sess-cli-human')).sessionKind).toBe('interactive');
});

test('session claude -p (chaîne sans marqueur humain) → headless', async () => {
  writeSessionTree(claudeDir, 'F--kind-claude-p', 'sess-claude-p', [
    promptLine('\uFEFFMODE AUTONOME : execute le plan sans confirmation'),
    assistantLine({ msgId: 'm1', model: 'claude-opus-4-8', usage: { input_tokens: 10, output_tokens: 5 } }),
  ]);
  expect((await reportOf('kind-claude-p', 'sess-claude-p')).sessionKind).toBe('headless');
});

test('un prompt en chaîne brute → headless, même mêlé à des blocs', async () => {
  writeSessionTree(claudeDir, 'F--kind-head', 'sess-head', [
    promptBlocksLine('bonjour'),
    promptLine('prompt de script claude -p'),
    assistantLine({ msgId: 'm1', model: 'claude-opus-4-8', usage: { input_tokens: 10, output_tokens: 5 } }),
  ]);
  expect((await reportOf('kind-head', 'sess-head')).sessionKind).toBe('headless');
});

test('événements meta seulement → unknown (un meta ne compte jamais comme prompt)', async () => {
  writeSessionTree(claudeDir, 'F--kind-meta', 'sess-meta', [
    promptLine('ligne meta du harnais', { isMeta: true }),
    assistantLine({ msgId: 'm1', model: 'claude-opus-4-8', usage: { input_tokens: 10, output_tokens: 5 } }),
  ]);
  expect((await reportOf('kind-meta', 'sess-meta')).sessionKind).toBe('unknown');
});

test(`le prompt en chaîne du transcript d'un sous-agent ne compte pas`, async () => {
  writeSessionTree(claudeDir, 'F--kind-sub', 'sess-sub', [
    promptBlocksLine('tâche principale'),
    assistantLine({ msgId: 'm1', model: 'claude-opus-4-8', usage: { input_tokens: 10, output_tokens: 5 } }),
  ], [{
    agentId: 'aaa',
    lines: [
      promptLine('tache dispatchee au sous-agent'),
      assistantLine({ msgId: 's1', model: 'claude-opus-4-8', usage: { input_tokens: 5, output_tokens: 2 }, isSidechain: true, agentId: 'aaa' }),
    ],
  }]);
  expect((await reportOf('kind-sub', 'sess-sub')).sessionKind).toBe('interactive');
});

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { SessionKindAggregator } from '../../src/doctor/aggregators/session-kind.js';
import { discoverSessions } from '../../src/core/discovery.js';
import { scanSession } from '../../src/doctor/scan-session.js';
import { assistantLine, promptBlocksLine, promptLine, writeSessionTree } from '../helpers/build-transcript.js';

const prompt = (
  shape: 'string' | 'blocks',
  over: Partial<{ text: string; promptSource: string; originKind: string }> = {},
) => ({
  kind: 'user_prompt' as const,
  text: over.text ?? 'x',
  shape,
  ...(over.promptSource ? { promptSource: over.promptSource } : {}),
  ...(over.originKind ? { originKind: over.originKind } : {}),
});

describe('SessionKindAggregator — la décision', () => {
  test('aucun prompt → unknown', () => {
    expect(new SessionKindAggregator().result()).toBe('unknown');
  });

  test('chaîne avec promptSource "typed" → interactive', () => {
    const agg = new SessionKindAggregator();
    agg.addPrompt(prompt('string', { promptSource: 'typed' }));
    expect(agg.result()).toBe('interactive');
  });

  test('chaîne avec originKind "human" → interactive', () => {
    const agg = new SessionKindAggregator();
    agg.addPrompt(prompt('string', { originKind: 'human' }));
    expect(agg.result()).toBe('interactive');
  });

  test('des blocs seulement → interactive', () => {
    const agg = new SessionKindAggregator();
    agg.addPrompt(prompt('blocks'));
    agg.addPrompt(prompt('blocks'));
    expect(agg.result()).toBe('interactive');
  });

  test('des blocs portant promptSource "sdk" restent interactive (cas VS Code réel)', () => {
    const agg = new SessionKindAggregator();
    agg.addPrompt(prompt('blocks', { promptSource: 'sdk' }));
    expect(agg.result()).toBe('interactive');
  });

  test('chaîne sans marqueur → headless', () => {
    const agg = new SessionKindAggregator();
    agg.addPrompt(prompt('string'));
    expect(agg.result()).toBe('headless');
  });

  test('mélange blocs + chaîne sans marqueur → headless (≥ 1 machine gagne)', () => {
    const agg = new SessionKindAggregator();
    agg.addPrompt(prompt('blocks'));
    agg.addPrompt(prompt('string'));
    agg.addPrompt(prompt('blocks'));
    expect(agg.result()).toBe('headless');
  });

  test('mélange chaîne typed + chaîne sans marqueur → headless (≥ 1 machine gagne)', () => {
    const agg = new SessionKindAggregator();
    agg.addPrompt(prompt('string', { promptSource: 'typed' }));
    agg.addPrompt(prompt('string'));
    expect(agg.result()).toBe('headless');
  });

  test('bruit du harnais seul → unknown (ne compte ni humain ni machine)', () => {
    const agg = new SessionKindAggregator();
    agg.addPrompt(prompt('string', { text: '<command-name>/clear</command-name>' }));
    expect(agg.result()).toBe('unknown');
  });
});

describe('scanSession — la session porte sa forme', () => {
  const claudeDir = mkdtempSync(path.join(tmpdir(), 'netgain-kind-'));
  afterAll(() => rmSync(claudeDir, { recursive: true, force: true }));

  async function reportOf(project: string, sessionId: string) {
    const refs = await discoverSessions(claudeDir, { project });
    const ref = refs.find((r) => r.sessionId === sessionId);
    expect(ref).toBeDefined();
    return scanSession(ref!, 100);
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
});

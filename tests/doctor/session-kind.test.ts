import { expect, test } from 'vitest';
import { SessionKindAggregator } from '../../src/engine/doctor/aggregators/session-kind.ts';

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

import { expect, test } from 'vitest';
import { PromptsAggregator } from '../../src/engine/doctor/aggregators/prompts.ts';

test('compte les prompts, la part forme-carte, et garde le corpus tronqué à 200 caractères', () => {
  const agg = new PromptsAggregator(10);
  agg.addPrompt({ kind: 'user_prompt', text: 'Où est définie la route des communes ?', shape: 'string' });
  agg.addPrompt({ kind: 'user_prompt', text: 'Corrige le bug', shape: 'string' });
  agg.addPrompt({ kind: 'user_prompt', text: `Quel impact si je change ${'x'.repeat(300)}`, shape: 'string' });
  agg.addPrompt({ kind: 'user_prompt', text: '<command-name>/foo</command-name>', shape: 'string' }); // bruit : ignoré
  const r = agg.result();
  expect(r.totalPrompts).toBe(3);
  expect(r.mapShapedCount).toBe(2);
  expect(r.corpus).toHaveLength(2);
  expect(r.corpus[0]).toEqual({ text: 'Où est définie la route des communes ?', category: 'where' });
  expect(r.corpus[1]?.text.length).toBe(200);
  expect(r.corpus[1]?.category).toBe('impact');
});

test('le corpus est plafonné par maxPrompts, les compteurs continuent', () => {
  const agg = new PromptsAggregator(2);
  agg.addPrompt({ kind: 'user_prompt', text: 'Où est le guard ?', shape: 'string' });
  agg.addPrompt({ kind: 'user_prompt', text: 'Où est la config ?', shape: 'string' });
  agg.addPrompt({ kind: 'user_prompt', text: 'Où est le module ?', shape: 'string' });
  const r = agg.result();
  expect(r.mapShapedCount).toBe(3);
  expect(r.corpus).toHaveLength(2);
});

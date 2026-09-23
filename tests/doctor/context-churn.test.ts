// Le churn de cache compte les re-créations de plus de 10k jetons. Le 1er tour d'un
// agent n'en est jamais une : il n'y a rien à relire. Le suivi est par agent, et la
// même ligne répétée ne compte pas deux fois.
import { expect, test } from 'vitest';
import { ContextAggregator } from '../../src/engine/doctor/aggregators/context.ts';
import { assistant } from '../helpers/context-events.ts';

test('le 1er tour d’un agent ne compte jamais comme churn ; les re-créations > 10k ensuite, oui', () => {
  const agg = new ContextAggregator();
  agg.addAssistant(assistant('m1', { cache_creation_input_tokens: 50000, input_tokens: 10, cache_read_input_tokens: 0, output_tokens: 1 }), 'main');
  agg.addAssistant(assistant('m2', { cache_creation_input_tokens: 500, input_tokens: 10, cache_read_input_tokens: 50000, output_tokens: 1 }), 'main');
  agg.addAssistant(assistant('m3', { cache_creation_input_tokens: 30000, input_tokens: 10, cache_read_input_tokens: 20000, output_tokens: 1 }), 'main');
  const r = agg.result();
  expect(r.cacheChurnEvents).toBe(1);
  expect(r.cacheChurnTokens).toBe(30000);
});

test('le churn est suivi par agent : le 1er tour de chaque sous-agent est exempté', () => {
  const agg = new ContextAggregator();
  agg.addAssistant(assistant('m1', { cache_creation_input_tokens: 40000, output_tokens: 1 }), 'main');
  agg.addAssistant(assistant('a1', { cache_creation_input_tokens: 40000, output_tokens: 1 }), 'agent-x');
  agg.addAssistant(assistant('a2', { cache_creation_input_tokens: 15000, output_tokens: 1 }), 'agent-x');
  const r = agg.result();
  expect(r.cacheChurnEvents).toBe(1);
  expect(r.cacheChurnTokens).toBe(15000);
});

test('dédup par msgId : la même ligne répétée ne compte pas double', () => {
  const agg = new ContextAggregator();
  const evt = assistant('m1', { cache_creation_input_tokens: 40000, output_tokens: 1 });
  const evt2 = assistant('m2', { cache_creation_input_tokens: 20000, output_tokens: 1 });
  agg.addAssistant(evt, 'main');
  agg.addAssistant(evt2, 'main');
  agg.addAssistant(evt2, 'main');
  const r = agg.result();
  expect(r.cacheChurnEvents).toBe(1);
  expect(r.cacheChurnTokens).toBe(20000);
});

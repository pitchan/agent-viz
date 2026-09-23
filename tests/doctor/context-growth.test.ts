// La croissance du contexte ne se mesure que sur la conversation principale : premier,
// maximum et dernier de `in + cacheRead + cacheCreate` par message.
import { expect, test } from 'vitest';
import { ContextAggregator } from '../../src/engine/doctor/aggregators/context.ts';
import { assistant } from '../helpers/context-events.ts';

test('premier/max/dernier de in+cacheRead+cacheCreate par message', () => {
  const agg = new ContextAggregator();
  agg.addAssistant(assistant('m1', { input_tokens: 100, cache_creation_input_tokens: 20000, cache_read_input_tokens: 0, output_tokens: 1 }), 'main');
  agg.addAssistant(assistant('m2', { input_tokens: 100, cache_creation_input_tokens: 500, cache_read_input_tokens: 90000, output_tokens: 1 }), 'main');
  agg.addAssistant(assistant('m3', { input_tokens: 100, cache_creation_input_tokens: 200, cache_read_input_tokens: 60000, output_tokens: 1 }), 'main');
  agg.addAssistant(assistant('a1', { input_tokens: 999999, output_tokens: 1 }), 'agent-x'); // ignoré pour la croissance
  const r = agg.result();
  expect(r.contextGrowth).toEqual({ first: 20100, max: 90600, last: 60300 });
});

test('sans aucun message main → first/last null', () => {
  const r = new ContextAggregator().result();
  expect(r.contextGrowth).toEqual({ first: null, max: 0, last: null });
});

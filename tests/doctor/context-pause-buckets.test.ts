// Les expirations rangées par durée de pause. Les tranches sous la durée de vie du cache
// restent vides par construction : une pause plus courte ne peut pas expirer le cache.
import { expect, test } from 'vitest';
import { ContextAggregator } from '../../src/engine/doctor/aggregators/context.ts';
import { assistant } from '../helpers/context-events.ts';

const T0 = '2026-07-13T10:00:00.000Z';
const plus = (seconds: number): string => new Date(Date.parse(T0) + seconds * 1000).toISOString();
const zero = { events: 0, tokens: 0 };

test('expiration sous durée de vie 5 min : pause de 10 min rangée dans la tranche 5–15 min', () => {
  const agg = new ContextAggregator();
  agg.addAssistant(assistant('m1', { cache_creation_input_tokens: 50000, cache_read_input_tokens: 0, output_tokens: 1 }, T0), 'main');
  agg.addAssistant(assistant('m2', { cache_creation_input_tokens: 60000, cache_read_input_tokens: 0, output_tokens: 1 }, plus(10 * 60)), 'main');
  const r = agg.result();
  expect(r.pauseBuckets.ttl5m.b5to15m).toEqual({ events: 1, tokens: 60000 });
  expect(r.pauseBuckets.ttl5m.b15to60m).toEqual(zero);
  expect(r.pauseBuckets.ttl1h.b1to3h).toEqual(zero);
});

test('tranches 15–60 min, 1–3 h et > 3 h sous durée de vie 5 min', () => {
  const agg = new ContextAggregator();
  agg.addAssistant(assistant('m1', { cache_creation_input_tokens: 50000, cache_read_input_tokens: 0, output_tokens: 1 }, T0), 'main');
  agg.addAssistant(assistant('m2', { cache_creation_input_tokens: 20000, cache_read_input_tokens: 0, output_tokens: 1 }, plus(40 * 60)), 'main');
  agg.addAssistant(assistant('m3', { cache_creation_input_tokens: 30000, cache_read_input_tokens: 0, output_tokens: 1 }, plus(40 * 60 + 2 * 3600)), 'main');
  agg.addAssistant(assistant('m4', { cache_creation_input_tokens: 40000, cache_read_input_tokens: 0, output_tokens: 1 }, plus(40 * 60 + 2 * 3600 + 4 * 3600)), 'main');
  const r = agg.result();
  expect(r.pauseBuckets.ttl5m.b15to60m).toEqual({ events: 1, tokens: 20000 });
  expect(r.pauseBuckets.ttl5m.b1to3h).toEqual({ events: 1, tokens: 30000 });
  expect(r.pauseBuckets.ttl5m.bOver3h).toEqual({ events: 1, tokens: 40000 });
});

test('expiration sous durée de vie 1 h : pause de 90 min → tranche 1–3 h ; les tranches < 1 h restent à zéro par construction', () => {
  const agg = new ContextAggregator();
  agg.addAssistant(
    assistant(
      'm1',
      { cache_creation_input_tokens: 50000, cache_read_input_tokens: 0, output_tokens: 1, cache_creation: { ephemeral_1h_input_tokens: 50000 } },
      T0,
    ),
    'main',
  );
  agg.addAssistant(assistant('m2', { cache_creation_input_tokens: 60000, cache_read_input_tokens: 0, output_tokens: 1 }, plus(90 * 60)), 'main');
  const r = agg.result();
  expect(r.pauseBuckets.ttl1h.b1to3h).toEqual({ events: 1, tokens: 60000 });
  expect(r.pauseBuckets.ttl1h.b5to15m).toEqual(zero);
  expect(r.pauseBuckets.ttl1h.b15to60m).toEqual(zero);
  expect(r.pauseBuckets.ttl5m.b1to3h).toEqual(zero);
});

test('invariant : la somme des tranches = la case expiration des causes', () => {
  const agg = new ContextAggregator();
  agg.addAssistant(assistant('m1', { cache_creation_input_tokens: 50000, cache_read_input_tokens: 0, output_tokens: 1 }, T0), 'main');
  agg.addAssistant(assistant('m2', { cache_creation_input_tokens: 30000, cache_read_input_tokens: 50000, output_tokens: 1 }, plus(30)), 'main'); // growth
  agg.addAssistant(assistant('m3', { cache_creation_input_tokens: 60000, cache_read_input_tokens: 0, output_tokens: 1 }, plus(20 * 60)), 'main'); // expiration 5–15 (pause ~19,5 min → 15–60)
  agg.addAssistant(assistant('m4', { cache_creation_input_tokens: 25000, cache_read_input_tokens: 0, output_tokens: 1 }, plus(20 * 60 + 5 * 3600)), 'main'); // expiration > 3 h
  agg.addAssistant(assistant('m5', { cache_creation_input_tokens: 40000, cache_read_input_tokens: 20000, output_tokens: 1 }, plus(20 * 60 + 5 * 3600 + 60)), 'main'); // prefixChange
  const r = agg.result();
  const cells = [...Object.values(r.pauseBuckets.ttl5m), ...Object.values(r.pauseBuckets.ttl1h)];
  expect(cells.reduce((a, c) => a + c.events, 0)).toBe(r.churnCauses.expiration.events);
  expect(cells.reduce((a, c) => a + c.tokens, 0)).toBe(r.churnCauses.expiration.tokens);
  expect(r.churnCauses.expiration.events).toBe(2);
});

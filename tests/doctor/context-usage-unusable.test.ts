import { expect, test } from 'vitest';
import { ContextAggregator } from '../../src/engine/doctor/aggregators/context.ts';
import { assistant } from '../helpers/context-events.ts';

// Un usage inexploitable est écarté comme un usage absent : le tour suivant se compare
// au dernier tour sain. Un identifiant vide n'est pas un identifiant.
const T0 = '2026-07-13T10:00:00.000Z';
const plus = (seconds: number): string => new Date(Date.parse(T0) + seconds * 1000).toISOString();
const malforme = { usageVerdict: 'malforme' } as const;

test('un cache_read_input_tokens inexploitable n’invente pas de cassure de préfixe', () => {
  // Arrange
  const agg = new ContextAggregator();
  const events = [
    assistant('m1', { input_tokens: 10, cache_creation_input_tokens: 50000, cache_read_input_tokens: 0, output_tokens: 1 }, T0),
    assistant('m2', { input_tokens: 10, cache_creation_input_tokens: 20000, cache_read_input_tokens: '50000', output_tokens: 1 } as never, plus(30), malforme),
    assistant('m3', { input_tokens: 10, cache_creation_input_tokens: 500, cache_read_input_tokens: 70000, output_tokens: 1 }, plus(60)),
  ];

  // Act
  for (const evt of events) agg.addAssistant(evt, 'main');
  const r = agg.result();

  // Assert
  expect(r.churnCauses.prefixChange.events).toBe(0);
  expect(r.cacheChurnEvents).toBe(0);
});

test('un usage inexploitable ne masque pas la cassure du tour suivant : elle se compare au dernier tour sain', () => {
  // Arrange
  const agg = new ContextAggregator();
  const events = [
    assistant('m1', { input_tokens: 10, cache_creation_input_tokens: 50000, cache_read_input_tokens: 0, output_tokens: 1 }, T0),
    assistant('m2', { input_tokens: 10, cache_creation_input_tokens: 500, cache_read_input_tokens: '50000', output_tokens: 1 } as never, plus(30), malforme),
    assistant('m3', { input_tokens: 10, cache_creation_input_tokens: 60000, cache_read_input_tokens: 0, output_tokens: 1 }, plus(60)),
  ];

  // Act
  for (const evt of events) agg.addAssistant(evt, 'main');
  const r = agg.result();

  // Assert
  expect(r.churnCauses.prefixChange).toEqual({ events: 1, tokens: 60000 });
});

test('un usage inexploitable n’entre pas dans la croissance du contexte', () => {
  // Arrange
  const agg = new ContextAggregator();
  const events = [
    assistant('m1', { input_tokens: 10, cache_creation_input_tokens: 50000, cache_read_input_tokens: 0, output_tokens: 1 }, T0),
    assistant('m2', { input_tokens: 10, cache_creation_input_tokens: 500, cache_read_input_tokens: '50000', output_tokens: 1 } as never, plus(30), malforme),
  ];

  // Act
  for (const evt of events) agg.addAssistant(evt, 'main');
  const r = agg.result();

  // Assert
  expect(r.contextGrowth).toEqual({ first: 50010, max: 50010, last: 50010 });
});

test('les écritures de cache d’un usage inexploitable ne sont pas comptées, comme ses cassures', () => {
  // Arrange
  const agg = new ContextAggregator();
  const events = [
    assistant('m1', { input_tokens: 10, cache_creation_input_tokens: 50000, cache_read_input_tokens: 0, output_tokens: 1 }, T0),
    assistant('m2', { input_tokens: 10, cache_creation_input_tokens: 20000, cache_read_input_tokens: '50000', output_tokens: 1 } as never, plus(30), malforme),
  ];

  // Act
  for (const evt of events) agg.addAssistant(evt, 'main');
  const r = agg.result();

  // Assert
  expect(r.cacheWrites).toEqual({ tokens5m: 0, tokens1h: 0, tokensUnknown: 50000 });
});

test('identifiant vide répété : deux messages distincts, jamais dédoublonnés', () => {
  const agg = new ContextAggregator();
  agg.addAssistant(assistant('', { cache_creation_input_tokens: 50000 }), 'main');
  agg.addAssistant(assistant('', { cache_creation_input_tokens: 30000, cache_read_input_tokens: 20000 }), 'main');
  const r = agg.result();
  expect(r.cacheChurnEvents).toBe(1);
  expect(r.cacheChurnTokens).toBe(30000);
});

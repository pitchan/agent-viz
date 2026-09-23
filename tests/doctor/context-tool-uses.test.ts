import { expect, test } from 'vitest';
import type { ToolUseRef } from '../../src/engine/core/events.ts';
import { ContextAggregator } from '../../src/engine/doctor/aggregators/context.ts';
import { assistant } from '../helpers/context-events.ts';

// Claude Code écrit une ligne par bloc de contenu, toutes avec le même identifiant et le même usage :
// un appel d'outil peut se trouver sur n'importe laquelle, l'usage ne se mesure qu'une fois.
const T0 = '2026-07-13T10:00:00.000Z';
const plus = (seconds: number): string => new Date(Date.parse(T0) + seconds * 1000).toISOString();
const zero = { events: 0, tokens: 0 };
const toolSearch: ToolUseRef = { id: 't1', name: 'ToolSearch', input: { query: 'select:TodoWrite' } };
const mcp: ToolUseRef = { id: 't2', name: 'mcp__mdb-explorer__mdb_geocode', input: {} };
const firstTurn = { input_tokens: 10, cache_creation_input_tokens: 50000, cache_read_input_tokens: 0, output_tokens: 1 };
const breakTurn = { input_tokens: 10, cache_creation_input_tokens: 60000, cache_read_input_tokens: 0, output_tokens: 1 };

test('un ToolSearch écrit sur la deuxième ligne d’un message marque la cassure du tour suivant « outils apparus »', () => {
  // Arrange
  const agg = new ContextAggregator();
  const events = [
    assistant('m1', firstTurn, T0),
    assistant('m1', firstTurn, T0, { toolUses: [toolSearch] }),
    assistant('m2', breakTurn, plus(60)),
  ];

  // Act
  for (const evt of events) agg.addAssistant(evt, 'main');
  const r = agg.result();

  // Assert
  expect(r.prefixBreakdown.markers.toolsAppeared).toEqual({ events: 1, tokens: 60000 });
  expect(r.prefixBreakdown.markers.noMarker).toEqual(zero);
});

test('le ToolSearch écrit sur une ligne suivante du message qui casse marque le tour d’après, jamais le sien', () => {
  // Arrange
  const agg = new ContextAggregator();
  const events = [
    assistant('m1', firstTurn, T0),
    assistant('m2', breakTurn, plus(60)),
    assistant('m2', breakTurn, plus(60), { toolUses: [toolSearch] }),
    assistant('m3', { input_tokens: 10, cache_creation_input_tokens: 40000, cache_read_input_tokens: 10000, output_tokens: 1 }, plus(120)),
  ];

  // Act
  for (const evt of events) agg.addAssistant(evt, 'main');
  const r = agg.result();

  // Assert
  expect(r.prefixBreakdown.markers.noMarker).toEqual({ events: 1, tokens: 60000 });
  expect(r.prefixBreakdown.markers.toolsAppeared).toEqual({ events: 1, tokens: 40000 });
});

test('un appel MCP écrit sur une ligne suivante range la cassure en début de session à serveurs MCP', () => {
  // Arrange
  const agg = new ContextAggregator();
  agg.addPrompt({ kind: 'user_prompt', text: 'question humaine', shape: 'blocks' });
  const events = [
    assistant('m1', firstTurn, T0),
    assistant('m1', firstTurn, T0, { toolUses: [mcp] }),
    assistant('m2', breakTurn, plus(60)),
  ];

  // Act
  for (const evt of events) agg.addAssistant(evt, 'main');
  const r = agg.result();

  // Assert
  expect(r.prefixBreakdown.noMarkerDetail.earlyMcp).toEqual({ events: 1, tokens: 60000 });
});

test('un message à l’usage inexploitable fait quand même voir son ToolSearch au tour suivant', () => {
  // Arrange
  const agg = new ContextAggregator();
  const events = [
    assistant('m1', firstTurn, T0),
    assistant('m2', { input_tokens: 10, cache_creation_input_tokens: 500, cache_read_input_tokens: '50000', output_tokens: 1 } as never, plus(30), { usageVerdict: 'malforme', toolUses: [toolSearch] }),
    assistant('m3', breakTurn, plus(60)),
  ];

  // Act
  for (const evt of events) agg.addAssistant(evt, 'main');
  const r = agg.result();

  // Assert
  expect(r.prefixBreakdown.markers.toolsAppeared).toEqual({ events: 1, tokens: 60000 });
});

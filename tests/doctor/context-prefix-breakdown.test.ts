// Ce qui a modifié le début de contexte : modèle changé, outils apparus, bloc d'outils ou
// historique modifié, plus la profondeur de la cassure. Un diagnostic journalisé prime sur
// l'heuristique ; sans bloc nommé, on retombe sur elle plutôt que de deviner.
import { expect, test } from 'vitest';
import type { ToolUseRef } from '../../src/engine/core/events.ts';
import { ContextAggregator } from '../../src/engine/doctor/aggregators/context.ts';
import { assistant } from '../helpers/context-events.ts';

const T0 = '2026-07-13T10:00:00.000Z';
const plus = (seconds: number): string => new Date(Date.parse(T0) + seconds * 1000).toISOString();
const zero = { events: 0, tokens: 0 };
const toolSearch: ToolUseRef = { id: 't1', name: 'ToolSearch', input: { query: 'select:TodoWrite' } };

test('modèle changé entre deux tours → « modèle changé », prioritaire sur « outils apparus »', () => {
  const agg = new ContextAggregator();
  agg.addAssistant(assistant('m1', { cache_creation_input_tokens: 50000, cache_read_input_tokens: 0, output_tokens: 1 }, T0, { toolUses: [toolSearch] }), 'main');
  agg.addAssistant(assistant('m2', { cache_creation_input_tokens: 60000, cache_read_input_tokens: 0, output_tokens: 1 }, plus(60), { model: 'claude-sonnet-5' }), 'main');
  const r = agg.result();
  expect(r.churnCauses.prefixChange).toEqual({ events: 1, tokens: 60000 });
  expect(r.prefixBreakdown.markers.modelSwitch).toEqual({ events: 1, tokens: 60000 });
  expect(r.prefixBreakdown.markers.toolsAppeared).toEqual(zero);
  expect(r.prefixBreakdown.markers.noMarker).toEqual(zero);
});

test('appel ToolSearch au tour précédent → « outils apparus » ; le drapeau est consommé', () => {
  const agg = new ContextAggregator();
  agg.addAssistant(assistant('m1', { cache_creation_input_tokens: 50000, cache_read_input_tokens: 0, output_tokens: 1 }, T0, { toolUses: [toolSearch] }), 'main');
  agg.addAssistant(assistant('m2', { cache_creation_input_tokens: 60000, cache_read_input_tokens: 0, output_tokens: 1 }, plus(60)), 'main');
  agg.addAssistant(assistant('m3', { cache_creation_input_tokens: 70000, cache_read_input_tokens: 0, output_tokens: 1 }, plus(120)), 'main');
  const r = agg.result();
  expect(r.prefixBreakdown.markers.toolsAppeared).toEqual({ events: 1, tokens: 60000 });
  expect(r.prefixBreakdown.markers.noMarker).toEqual({ events: 1, tokens: 70000 });
});

test('le ToolSearch d’un autre agent ne marque pas main', () => {
  const agg = new ContextAggregator();
  agg.addAssistant(assistant('m1', { cache_creation_input_tokens: 50000, cache_read_input_tokens: 0, output_tokens: 1 }, T0), 'main');
  agg.addAssistant(assistant('a1', { cache_creation_input_tokens: 40000, cache_read_input_tokens: 0, output_tokens: 1 }, plus(10), { toolUses: [toolSearch] }), 'agent-x');
  agg.addAssistant(assistant('m2', { cache_creation_input_tokens: 60000, cache_read_input_tokens: 0, output_tokens: 1 }, plus(60)), 'main');
  const r = agg.result();
  expect(r.prefixBreakdown.markers.toolsAppeared).toEqual(zero);
  expect(r.prefixBreakdown.markers.noMarker).toEqual({ events: 1, tokens: 60000 });
});

test('modèle absent d’un côté → jamais classé « modèle changé »', () => {
  const agg = new ContextAggregator();
  agg.addAssistant(assistant('m1', { cache_creation_input_tokens: 50000, cache_read_input_tokens: 0, output_tokens: 1 }, T0, { model: null }), 'main');
  agg.addAssistant(assistant('m2', { cache_creation_input_tokens: 60000, cache_read_input_tokens: 0, output_tokens: 1 }, plus(60)), 'main');
  const r = agg.result();
  expect(r.prefixBreakdown.markers.modelSwitch).toEqual(zero);
  expect(r.prefixBreakdown.markers.noMarker).toEqual({ events: 1, tokens: 60000 });
});

test('diagnostic journalisé tools_changed → « bloc outils modifié », prioritaire sur « outils apparus »', () => {
  const agg = new ContextAggregator();
  agg.addAssistant(assistant('m1', { cache_creation_input_tokens: 50000, cache_read_input_tokens: 0, output_tokens: 1 }, T0, { toolUses: [toolSearch] }), 'main');
  agg.addAssistant(assistant('m2', { cache_creation_input_tokens: 60000, cache_read_input_tokens: 0, output_tokens: 1 }, plus(60), { cacheMissReason: 'tools_changed' }), 'main');
  const r = agg.result();
  expect(r.prefixBreakdown.markers.toolsChanged).toEqual({ events: 1, tokens: 60000 });
  expect(r.prefixBreakdown.markers.toolsAppeared).toEqual(zero);
  expect(r.prefixBreakdown.markers.noMarker).toEqual(zero);
});

test('diagnostic journalisé, prioritaire sur le changement de modèle observé (première main)', () => {
  const agg = new ContextAggregator();
  agg.addAssistant(assistant('m1', { cache_creation_input_tokens: 50000, cache_read_input_tokens: 0, output_tokens: 1 }, T0), 'main');
  agg.addAssistant(assistant('m2', { cache_creation_input_tokens: 60000, cache_read_input_tokens: 0, output_tokens: 1 }, plus(60), { model: 'claude-sonnet-5', cacheMissReason: 'system_changed' }), 'main');
  const r = agg.result();
  expect(r.prefixBreakdown.markers.systemChanged).toEqual({ events: 1, tokens: 60000 });
  expect(r.prefixBreakdown.markers.modelSwitch).toEqual(zero);
});

test('diagnostic model_changed → « modèle changé », même sans deux modèles observés', () => {
  const agg = new ContextAggregator();
  agg.addAssistant(assistant('m1', { cache_creation_input_tokens: 50000, cache_read_input_tokens: 0, output_tokens: 1 }, T0), 'main');
  agg.addAssistant(assistant('m2', { cache_creation_input_tokens: 60000, cache_read_input_tokens: 0, output_tokens: 1 }, plus(60), { cacheMissReason: 'model_changed' }), 'main');
  const r = agg.result();
  expect(r.prefixBreakdown.markers.modelSwitch).toEqual({ events: 1, tokens: 60000 });
  expect(r.prefixBreakdown.markers.noMarker).toEqual(zero);
});

test('diagnostic messages_changed → « historique modifié »', () => {
  const agg = new ContextAggregator();
  agg.addAssistant(assistant('m1', { cache_creation_input_tokens: 50000, cache_read_input_tokens: 0, output_tokens: 1 }, T0), 'main');
  agg.addAssistant(assistant('m2', { cache_creation_input_tokens: 60000, cache_read_input_tokens: 0, output_tokens: 1 }, plus(60), { cacheMissReason: 'messages_changed' }), 'main');
  const r = agg.result();
  expect(r.prefixBreakdown.markers.messagesChanged).toEqual({ events: 1, tokens: 60000 });
});

test('diagnostic sans bloc nommé (unavailable) → retombe sur les heuristiques, jamais deviné', () => {
  const agg = new ContextAggregator();
  agg.addAssistant(assistant('m1', { cache_creation_input_tokens: 50000, cache_read_input_tokens: 0, output_tokens: 1 }, T0), 'main');
  agg.addAssistant(assistant('m2', { cache_creation_input_tokens: 60000, cache_read_input_tokens: 0, output_tokens: 1 }, plus(60), { cacheMissReason: 'unavailable' }), 'main');
  const r = agg.result();
  expect(r.prefixBreakdown.markers.noMarker).toEqual({ events: 1, tokens: 60000 });
  expect(r.prefixBreakdown.markers.systemChanged).toEqual(zero);
  expect(r.prefixBreakdown.markers.toolsChanged).toEqual(zero);
  expect(r.prefixBreakdown.markers.messagesChanged).toEqual(zero);
});

test('profondeur de cassure : ratio relu/attendu rangé en façade / 10–50 / 50–90 / queue', () => {
  const depthOf = (read: number) => {
    const agg = new ContextAggregator();
    agg.addAssistant(assistant('m1', { cache_creation_input_tokens: 50000, cache_read_input_tokens: 0, output_tokens: 1 }, T0), 'main');
    agg.addAssistant(assistant('m2', { cache_creation_input_tokens: 20000, cache_read_input_tokens: read, output_tokens: 1 }, plus(60)), 'main');
    return agg.result().prefixBreakdown.depth;
  };
  expect(depthOf(0).facade).toEqual({ events: 1, tokens: 20000 });
  expect(depthOf(5000).facade).toEqual({ events: 1, tokens: 20000 }); // borne : 10 % inclus dans la façade
  expect(depthOf(15000).d10to50).toEqual({ events: 1, tokens: 20000 });
  expect(depthOf(35000).d50to90).toEqual({ events: 1, tokens: 20000 });
  expect(depthOf(47500).tail).toEqual({ events: 1, tokens: 20000 });
  const d = depthOf(0);
  expect(d.d10to50).toEqual(zero);
  expect(d.d50to90).toEqual(zero);
  expect(d.tail).toEqual(zero);
});

test('seules les re-créations classées « préfixe modifié » alimentent le breakdown', () => {
  const agg = new ContextAggregator();
  agg.addAssistant(assistant('m1', { cache_creation_input_tokens: 50000, cache_read_input_tokens: 0, output_tokens: 1 }, T0), 'main');
  agg.addAssistant(assistant('m2', { cache_creation_input_tokens: 30000, cache_read_input_tokens: 50000, output_tokens: 1 }, plus(30)), 'main'); // growth
  agg.addAssistant(assistant('m3', { cache_creation_input_tokens: 60000, cache_read_input_tokens: 0, output_tokens: 1 }, plus(30 * 60)), 'main'); // expiration
  agg.addCompact({ kind: 'compact', trigger: 'auto', preTokens: 100000 }, 'main');
  agg.addAssistant(assistant('m4', { cache_creation_input_tokens: 70000, cache_read_input_tokens: 0, output_tokens: 1 }, plus(31 * 60)), 'main'); // compaction
  const r = agg.result();
  expect(Object.values(r.prefixBreakdown.markers).reduce((a, c) => a + c.events, 0)).toBe(0);
  expect(Object.values(r.prefixBreakdown.depth).reduce((a, c) => a + c.events, 0)).toBe(0);
});

test('invariant : marqueurs ET profondeur somment exactement à la case « préfixe modifié »', () => {
  const agg = new ContextAggregator();
  agg.addAssistant(assistant('m1', { cache_creation_input_tokens: 50000, cache_read_input_tokens: 0, output_tokens: 1 }, T0), 'main');
  agg.addAssistant(assistant('m2', { cache_creation_input_tokens: 60000, cache_read_input_tokens: 0, output_tokens: 1 }, plus(60), { model: 'claude-sonnet-5', toolUses: [toolSearch] }), 'main'); // modelSwitch
  agg.addAssistant(assistant('m3', { cache_creation_input_tokens: 40000, cache_read_input_tokens: 20000, output_tokens: 1 }, plus(120), { model: 'claude-sonnet-5' }), 'main'); // toolsAppeared
  agg.addAssistant(assistant('m4', { cache_creation_input_tokens: 30000, cache_read_input_tokens: 55000, output_tokens: 1 }, plus(180), { model: 'claude-sonnet-5' }), 'main'); // noMarker, cassure en queue (relu 55 000/60 000)
  agg.addAssistant(assistant('m5', { cache_creation_input_tokens: 25000, cache_read_input_tokens: 50000, output_tokens: 1 }, plus(240), { model: 'claude-sonnet-5' }), 'main'); // noMarker (relu 50 000/85 000 attendus)
  const r = agg.result();
  const markers = Object.values(r.prefixBreakdown.markers);
  const depth = Object.values(r.prefixBreakdown.depth);
  expect(markers.reduce((a, c) => a + c.events, 0)).toBe(r.churnCauses.prefixChange.events);
  expect(markers.reduce((a, c) => a + c.tokens, 0)).toBe(r.churnCauses.prefixChange.tokens);
  expect(depth.reduce((a, c) => a + c.events, 0)).toBe(r.churnCauses.prefixChange.events);
  expect(depth.reduce((a, c) => a + c.tokens, 0)).toBe(r.churnCauses.prefixChange.tokens);
  expect(r.churnCauses.prefixChange.events).toBeGreaterThanOrEqual(3);
});

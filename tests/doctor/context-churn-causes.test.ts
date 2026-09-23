// Pourquoi le cache a été re-créé : croissance, expiration, compactage, début de contexte
// modifié, ou inconnu quand rien ne le dit. Un horodatage absent ne se devine pas.
import { expect, test } from 'vitest';
import { ContextAggregator } from '../../src/engine/doctor/aggregators/context.ts';
import { assistant } from '../helpers/context-events.ts';

const T0 = '2026-07-13T10:00:00.000Z';
const plus = (seconds: number): string => new Date(Date.parse(T0) + seconds * 1000).toISOString();
const zero = { events: 0, tokens: 0 };

test('cache relu en entier + gros ajout → fausse alerte (growth), compteur historique inchangé', () => {
  const agg = new ContextAggregator();
  agg.addAssistant(assistant('m1', { cache_creation_input_tokens: 50000, cache_read_input_tokens: 0, output_tokens: 1 }, T0), 'main');
  // Le tour suivant relit les 50 000 tk en entier : le gros cache_creation est un AJOUT (grosse lecture), pas une re-création.
  agg.addAssistant(assistant('m2', { cache_creation_input_tokens: 30000, cache_read_input_tokens: 50000, output_tokens: 1 }, plus(30)), 'main');
  const r = agg.result();
  expect(r.cacheChurnEvents).toBe(1);
  expect(r.cacheChurnTokens).toBe(30000);
  expect(r.churnCauses.growth).toEqual({ events: 1, tokens: 30000 });
  expect(r.churnCauses.expiration).toEqual(zero);
  expect(r.churnCauses.prefixChange).toEqual(zero);
});

test('cache perdu après une pause > 5 min → expiration', () => {
  const agg = new ContextAggregator();
  agg.addAssistant(assistant('m1', { cache_creation_input_tokens: 50000, cache_read_input_tokens: 0, output_tokens: 1 }, T0), 'main');
  agg.addAssistant(assistant('m2', { cache_creation_input_tokens: 60000, cache_read_input_tokens: 0, output_tokens: 1 }, plus(20 * 60)), 'main');
  expect(agg.result().churnCauses.expiration).toEqual({ events: 1, tokens: 60000 });
});

test('cache 1 h écrit au tour précédent : 30 min de pause ne sont PAS une expiration → prefixChange', () => {
  const agg = new ContextAggregator();
  agg.addAssistant(
    assistant(
      'm1',
      {
        cache_creation_input_tokens: 50000,
        cache_read_input_tokens: 0,
        output_tokens: 1,
        cache_creation: { ephemeral_1h_input_tokens: 50000 },
      },
      T0,
    ),
    'main',
  );
  agg.addAssistant(assistant('m2', { cache_creation_input_tokens: 60000, cache_read_input_tokens: 0, output_tokens: 1 }, plus(30 * 60)), 'main');
  const r = agg.result();
  expect(r.churnCauses.expiration).toEqual(zero);
  expect(r.churnCauses.prefixChange).toEqual({ events: 1, tokens: 60000 });
});

test('pause > 1 h avec cache 1 h → expiration', () => {
  const agg = new ContextAggregator();
  agg.addAssistant(
    assistant(
      'm1',
      {
        cache_creation_input_tokens: 50000,
        cache_read_input_tokens: 0,
        output_tokens: 1,
        cache_creation: { ephemeral_1h_input_tokens: 50000 },
      },
      T0,
    ),
    'main',
  );
  agg.addAssistant(assistant('m2', { cache_creation_input_tokens: 60000, cache_read_input_tokens: 0, output_tokens: 1 }, plus(90 * 60)), 'main');
  expect(agg.result().churnCauses.expiration).toEqual({ events: 1, tokens: 60000 });
});

test('compactage depuis la réponse précédente → compaction, prioritaire sur la pause ; le drapeau est consommé', () => {
  const agg = new ContextAggregator();
  agg.addAssistant(assistant('m1', { cache_creation_input_tokens: 50000, cache_read_input_tokens: 0, output_tokens: 1 }, T0), 'main');
  agg.addCompact({ kind: 'compact', trigger: 'auto', preTokens: 100000 }, 'main');
  agg.addAssistant(assistant('m2', { cache_creation_input_tokens: 60000, cache_read_input_tokens: 0, output_tokens: 1 }, plus(20 * 60)), 'main');
  // Drapeau consommé : la re-création suivante (sans nouveau compactage, sans pause) n'est plus du compactage.
  agg.addAssistant(assistant('m3', { cache_creation_input_tokens: 70000, cache_read_input_tokens: 0, output_tokens: 1 }, plus(20 * 60 + 30)), 'main');
  const r = agg.result();
  expect(r.churnCauses.compaction).toEqual({ events: 1, tokens: 60000 });
  expect(r.churnCauses.prefixChange).toEqual({ events: 1, tokens: 70000 });
});

test('le compactage d’un autre agent ne marque pas main', () => {
  const agg = new ContextAggregator();
  agg.addAssistant(assistant('m1', { cache_creation_input_tokens: 50000, cache_read_input_tokens: 0, output_tokens: 1 }, T0), 'main');
  agg.addCompact({ kind: 'compact', trigger: 'auto', preTokens: 100000 }, 'agent-x');
  agg.addAssistant(assistant('m2', { cache_creation_input_tokens: 60000, cache_read_input_tokens: 0, output_tokens: 1 }, plus(60)), 'main');
  const r = agg.result();
  expect(r.churnCauses.compaction).toEqual(zero);
  expect(r.churnCauses.prefixChange).toEqual({ events: 1, tokens: 60000 });
});

test('cache partiellement perdu sans pause ni compactage → prefixChange (début de contexte modifié)', () => {
  const agg = new ContextAggregator();
  agg.addAssistant(assistant('m1', { cache_creation_input_tokens: 50000, cache_read_input_tokens: 0, output_tokens: 1 }, T0), 'main');
  agg.addAssistant(assistant('m2', { cache_creation_input_tokens: 40000, cache_read_input_tokens: 20000, output_tokens: 1 }, plus(60)), 'main');
  expect(agg.result().churnCauses.prefixChange).toEqual({ events: 1, tokens: 40000 });
});

test('horodatage absent → unknown, jamais deviné', () => {
  const agg = new ContextAggregator();
  agg.addAssistant(assistant('m1', { cache_creation_input_tokens: 50000, cache_read_input_tokens: 0, output_tokens: 1 }), 'main');
  agg.addAssistant(assistant('m2', { cache_creation_input_tokens: 60000, cache_read_input_tokens: 0, output_tokens: 1 }), 'main');
  expect(agg.result().churnCauses.unknown).toEqual({ events: 1, tokens: 60000 });
});

test('invariant : les causes s’additionnent exactement aux compteurs historiques', () => {
  const agg = new ContextAggregator();
  agg.addAssistant(assistant('m1', { cache_creation_input_tokens: 50000, cache_read_input_tokens: 0, output_tokens: 1 }, T0), 'main');
  agg.addAssistant(assistant('m2', { cache_creation_input_tokens: 30000, cache_read_input_tokens: 50000, output_tokens: 1 }, plus(30)), 'main'); // growth
  agg.addAssistant(assistant('m3', { cache_creation_input_tokens: 60000, cache_read_input_tokens: 0, output_tokens: 1 }, plus(30 * 60)), 'main'); // expiration
  agg.addAssistant(assistant('m4', { cache_creation_input_tokens: 40000, cache_read_input_tokens: 20000, output_tokens: 1 }, plus(31 * 60)), 'main'); // prefixChange
  agg.addAssistant(assistant('m5', { cache_creation_input_tokens: 500, cache_read_input_tokens: 60000, output_tokens: 1 }, plus(32 * 60)), 'main'); // sous le seuil : nulle part
  const r = agg.result();
  const causes = Object.values(r.churnCauses);
  expect(causes.reduce((a, c) => a + c.events, 0)).toBe(r.cacheChurnEvents);
  expect(causes.reduce((a, c) => a + c.tokens, 0)).toBe(r.cacheChurnTokens);
  expect(r.cacheChurnEvents).toBe(3);
});

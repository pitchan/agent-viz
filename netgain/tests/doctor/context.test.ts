import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import type { NormalizedEvent, RawUsage, ToolUseRef } from '../../src/core/events.js';
import { ContextAggregator, findClaudeMdFiles } from '../../src/doctor/aggregators/context.js';

function assistant(
  msgId: string,
  usage: RawUsage,
  timestamp?: string,
  opts?: { model?: string | null; toolUses?: ToolUseRef[] },
): Extract<NormalizedEvent, { kind: 'assistant' }> {
  return {
    kind: 'assistant',
    msgId,
    model: opts?.model !== undefined ? opts.model : 'claude-opus-4-8',
    usage,
    toolUses: opts?.toolUses ?? [],
    textChars: 0,
    ...(timestamp !== undefined ? { timestamp } : {}),
    isSidechain: false,
  };
}

describe('ContextAggregator — churn de cache', () => {
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
});

describe('ContextAggregator — croissance du contexte (main seulement)', () => {
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
});

describe('ContextAggregator — compactions', () => {
  test('collecte trigger et preTokens', () => {
    const agg = new ContextAggregator();
    agg.addCompact({ kind: 'compact', trigger: 'auto', preTokens: 365785 }, 'main');
    agg.addCompact({ kind: 'compact', trigger: 'manual', preTokens: null }, 'main');
    expect(agg.result().compactions).toEqual([
      { trigger: 'auto', preTokens: 365785 },
      { trigger: 'manual', preTokens: null },
    ]);
  });
});

describe('ContextAggregator — causes de la re-création de cache (churnCauses)', () => {
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
});

describe('ContextAggregator — histogramme des pauses (pauseBuckets)', () => {
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
});

describe('ContextAggregator — sous-ventilation du « préfixe modifié » (prefixBreakdown)', () => {
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
});

describe('ContextAggregator — mix des écritures de cache (cacheWrites)', () => {
  test('ventile 5 min / 1 h / indéterminé selon le détail présent dans le journal', () => {
    const agg = new ContextAggregator();
    agg.addAssistant(
      assistant('m1', {
        cache_creation_input_tokens: 50000,
        output_tokens: 1,
        cache_creation: { ephemeral_5m_input_tokens: 30000, ephemeral_1h_input_tokens: 20000 },
      }),
      'main',
    );
    agg.addAssistant(assistant('m2', { cache_creation_input_tokens: 10000, output_tokens: 1 }), 'main'); // pas de détail → indéterminé
    agg.addAssistant(
      assistant('m3', { cache_creation_input_tokens: 5000, output_tokens: 1, cache_creation: { ephemeral_5m_input_tokens: 3000 } }),
      'main',
    ); // reste non couvert par le détail → indéterminé
    expect(agg.result().cacheWrites).toEqual({ tokens5m: 33000, tokens1h: 20000, tokensUnknown: 12000 });
  });

  test('dédup par msgId : la même ligne répétée ne compte pas double', () => {
    const agg = new ContextAggregator();
    const evt = assistant('m1', { cache_creation_input_tokens: 40000, output_tokens: 1, cache_creation: { ephemeral_5m_input_tokens: 40000 } });
    agg.addAssistant(evt, 'main');
    agg.addAssistant(evt, 'main');
    expect(agg.result().cacheWrites).toEqual({ tokens5m: 40000, tokens1h: 0, tokensUnknown: 0 });
  });
});

describe('findClaudeMdFiles', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'netgain-ctx-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test('remonte les CLAUDE.md existants (cwd, cwd/.claude, claudeDir) avec leur taille disque', () => {
    const cwd = path.join(dir, 'proj');
    const claudeDir = path.join(dir, 'home-claude');
    mkdirSync(path.join(cwd, '.claude'), { recursive: true });
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(path.join(cwd, 'CLAUDE.md'), 'x'.repeat(1234));
    writeFileSync(path.join(claudeDir, 'CLAUDE.md'), 'y'.repeat(50));
    const found = findClaudeMdFiles(cwd, claudeDir);
    expect(found).toEqual([
      { path: path.join(cwd, 'CLAUDE.md'), bytes: 1234 },
      { path: path.join(claudeDir, 'CLAUDE.md'), bytes: 50 },
    ]);
  });

  test('cwd null → seulement le CLAUDE.md global éventuel', () => {
    const claudeDir = path.join(dir, 'home-claude2');
    mkdirSync(claudeDir, { recursive: true });
    expect(findClaudeMdFiles(null, claudeDir)).toEqual([]);
  });
});

import { describe, expect, test } from 'vitest';
import { ContextAggregator, EARLY_TURN_MAX } from '../../src/engine/doctor/aggregators/context.js';
import type { NormalizedEvent } from '../../src/engine/core/events.js';

type AssistantEvt = Extract<NormalizedEvent, { kind: 'assistant' }>;
type UserPromptEvt = Extract<NormalizedEvent, { kind: 'user_prompt' }>;

const HUMAN_PROMPT: UserPromptEvt = { kind: 'user_prompt', text: 'question humaine', shape: 'blocks' };
const MCP_USE = { id: 't-mcp', name: 'mcp__mdb-explorer__mdb_geocode', input: {} };

function asst(o: {
  cacheCreate: number; cacheRead: number; ts: string;
  model?: string; toolUses?: AssistantEvt['toolUses'];
}): AssistantEvt {
  return {
    kind: 'assistant',
    msgId: `m-${o.ts}`,
    model: o.model ?? 'claude-opus-4-8',
    usage: {
      input_tokens: 10,
      output_tokens: 5,
      cache_creation_input_tokens: o.cacheCreate,
      cache_read_input_tokens: o.cacheRead,
    },
    toolUses: o.toolUses ?? [],
    textChars: 0,
    timestamp: o.ts,
    isSidechain: false,
  };
}

// Motif de cassure « préfixe modifié sans marqueur » : même modèle, pas de
// ToolSearch, pas de compaction, pause courte, cache_read qui plonge sous le
// préfixe précédent, cache_creation massif. Si un test ne déclenche aucun
// churn, vérifier CHURN_THRESHOLD dans context.ts et AUGMENTER cacheCreate —
// jamais abaisser l'assertion.
function breakScenario(agg: ContextAggregator, agentKey: string, toolUses: AssistantEvt['toolUses'] = []) {
  agg.addAssistant(asst({ cacheCreate: 100_000, cacheRead: 0, ts: '2026-07-01T10:00:00.000Z', toolUses }), agentKey);
  agg.addAssistant(asst({ cacheCreate: 60_000, cacheRead: 10_000, ts: '2026-07-01T10:00:10.000Z' }), agentKey);
}

describe('noMarkerDetail — ventilation des cassures sans marqueur', () => {
  test('cassure au tour 1 dans une session à outils MCP → earlyMcp, somme égale au seau parent', () => {
    const agg = new ContextAggregator();
    agg.addPrompt(HUMAN_PROMPT); // tour 1
    breakScenario(agg, 'main', [MCP_USE]);
    const { prefixBreakdown } = agg.result();
    expect(prefixBreakdown.markers.noMarker).toEqual({ events: 1, tokens: 60_000 });
    expect(prefixBreakdown.noMarkerDetail.earlyMcp).toEqual({ events: 1, tokens: 60_000 });
    expect(prefixBreakdown.noMarkerDetail.other).toEqual({ events: 0, tokens: 0 });
  });

  test('sans aucun outil MCP dans la session → other', () => {
    const agg = new ContextAggregator();
    agg.addPrompt(HUMAN_PROMPT);
    breakScenario(agg, 'main');
    const { prefixBreakdown } = agg.result();
    expect(prefixBreakdown.noMarkerDetail.earlyMcp).toEqual({ events: 0, tokens: 0 });
    expect(prefixBreakdown.noMarkerDetail.other).toEqual({ events: 1, tokens: 60_000 });
  });

  test(`cassure après le tour ${EARLY_TURN_MAX}, même avec MCP → other`, () => {
    const agg = new ContextAggregator();
    agg.addAssistant(asst({ cacheCreate: 100_000, cacheRead: 0, ts: '2026-07-01T10:00:00.000Z', toolUses: [MCP_USE] }), 'main');
    for (let i = 0; i < EARLY_TURN_MAX + 1; i += 1) agg.addPrompt(HUMAN_PROMPT); // tours 1..6
    agg.addAssistant(asst({ cacheCreate: 60_000, cacheRead: 10_000, ts: '2026-07-01T10:00:10.000Z' }), 'main');
    expect(agg.result().prefixBreakdown.noMarkerDetail.other).toEqual({ events: 1, tokens: 60_000 });
  });

  test('un appel MCP APRÈS la cassure classe quand même earlyMcp (propriété de session, ventilation différée)', () => {
    const agg = new ContextAggregator();
    agg.addPrompt(HUMAN_PROMPT);
    breakScenario(agg, 'main');
    agg.addAssistant(asst({ cacheCreate: 0, cacheRead: 70_000, ts: '2026-07-01T10:00:20.000Z', toolUses: [MCP_USE] }), 'main');
    expect(agg.result().prefixBreakdown.noMarkerDetail.earlyMcp).toEqual({ events: 1, tokens: 60_000 });
  });

  test('la cassure d’un sous-agent va dans other — la position se mesure sur l’agent principal', () => {
    const agg = new ContextAggregator();
    agg.addPrompt(HUMAN_PROMPT);
    breakScenario(agg, 'agent-aaa', [MCP_USE]);
    const { prefixBreakdown } = agg.result();
    expect(prefixBreakdown.noMarkerDetail.earlyMcp).toEqual({ events: 0, tokens: 0 });
    expect(prefixBreakdown.noMarkerDetail.other).toEqual({ events: 1, tokens: 60_000 });
  });

  test('un changement de modèle reste dans modelSwitch : noMarkerDetail reste vide et la somme tient', () => {
    const agg = new ContextAggregator();
    agg.addPrompt(HUMAN_PROMPT);
    agg.addAssistant(asst({ cacheCreate: 100_000, cacheRead: 0, ts: '2026-07-01T10:00:00.000Z', toolUses: [MCP_USE] }), 'main');
    agg.addAssistant(asst({ cacheCreate: 60_000, cacheRead: 10_000, ts: '2026-07-01T10:00:10.000Z', model: 'claude-sonnet-5' }), 'main');
    const { prefixBreakdown } = agg.result();
    expect(prefixBreakdown.markers.modelSwitch.events).toBe(1);
    expect(prefixBreakdown.noMarkerDetail.earlyMcp).toEqual({ events: 0, tokens: 0 });
    expect(prefixBreakdown.noMarkerDetail.other).toEqual({ events: 0, tokens: 0 });
  });

  test('result() est stable rappelé deux fois (la ventilation ne mute pas l’état)', () => {
    const agg = new ContextAggregator();
    agg.addPrompt(HUMAN_PROMPT);
    breakScenario(agg, 'main', [MCP_USE]);
    const first = agg.result().prefixBreakdown.noMarkerDetail;
    const second = agg.result().prefixBreakdown.noMarkerDetail;
    expect(second).toEqual(first);
  });

  test('invariant d’homogénéité sur un mélange : earlyMcp + other = noMarker, en events et en tokens', () => {
    const agg = new ContextAggregator();
    agg.addPrompt(HUMAN_PROMPT); // tour 1
    breakScenario(agg, 'main', [MCP_USE]); // cassure early
    for (let i = 0; i < EARLY_TURN_MAX; i += 1) agg.addPrompt(HUMAN_PROMPT); // tours 2..6
    agg.addAssistant(asst({ cacheCreate: 40_000, cacheRead: 5_000, ts: '2026-07-01T10:05:00.000Z' }), 'main'); // cassure tardive
    const { prefixBreakdown } = agg.result();
    const d = prefixBreakdown.noMarkerDetail;
    expect(d.earlyMcp.events + d.other.events).toBe(prefixBreakdown.markers.noMarker.events);
    expect(d.earlyMcp.tokens + d.other.tokens).toBe(prefixBreakdown.markers.noMarker.tokens);
    expect(d.earlyMcp.events).toBe(1);
    expect(d.other.events).toBe(1);
  });
});

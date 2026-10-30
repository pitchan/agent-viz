// La durée d'un sous-agent Claude Code part du lancement de l'outil Agent qui l'a créé, à toutes les profondeurs.
// Séquence rejouée depuis une session `claude -p` réelle (Claude Code 2.1), identifiants anonymisés.

import { beforeEach, expect, test } from 'vitest';
import { state } from '../../src/web/viz-state.ts';
import { processEvent, type HookEvent } from '../../src/web/viz-graph.ts';
import { resetGraph } from '../helpers/viz-graph-events.ts';

beforeEach(resetGraph);

const rejouer = (evts: HookEvent[]) => { for (const e of evts) processEvent(e); };

const SID = '00000000-0000-4000-8000-000000000034';
const ENFANT = 'a000000000000e034';
const PETIT_FILS = 'a000000000000f034';

const CLAUDE: HookEvent[] = [
  { hook_event_name: 'SessionStart', session_id: SID, _ts: '2026-10-29T22:37:43.192Z' },
  { hook_event_name: 'PreToolUse', session_id: SID, tool_name: 'Agent', tool_use_id: 'toolu_racine',
    tool_input: { description: 'Sous-agent imbriqué lecture' }, _ts: '2026-10-29T22:37:47.153Z' },
  { hook_event_name: 'PreToolUse', session_id: SID, agent_id: ENFANT, agent_type: 'general-purpose',
    tool_name: 'Agent', tool_use_id: 'toolu_enfant', tool_input: { description: 'Lire cible.txt' }, _ts: '2026-10-29T22:37:50.231Z' },
  { hook_event_name: 'PreToolUse', session_id: SID, agent_id: PETIT_FILS, agent_type: 'general-purpose',
    tool_name: 'Read', tool_use_id: 'toolu_lecture', tool_input: { file_path: 'cible.txt' }, _ts: '2026-10-29T22:37:52.662Z' },
  { hook_event_name: 'PostToolUse', session_id: SID, agent_id: PETIT_FILS, agent_type: 'general-purpose',
    tool_name: 'Read', tool_use_id: 'toolu_lecture', _ts: '2026-10-29T22:37:52.788Z' },
  { hook_event_name: 'PostToolUse', session_id: SID, agent_id: ENFANT, agent_type: 'general-purpose',
    tool_name: 'Agent', tool_use_id: 'toolu_enfant', tool_response: { agentId: PETIT_FILS, status: 'completed' }, _ts: '2026-10-29T22:37:53.950Z' },
  { hook_event_name: 'PostToolUse', session_id: SID, tool_name: 'Agent', tool_use_id: 'toolu_racine',
    tool_response: { agentId: ENFANT, status: 'completed' }, _ts: '2026-10-29T22:37:55.294Z' },
  { hook_event_name: 'Stop', session_id: SID, _ts: '2026-10-29T22:37:58.316Z' },
];

test('Claude Code : le sous-agent dure autant que l\'outil Agent de la session qui l\'a lancé', () => {
  // Arrange
  const evenements = CLAUDE;
  // Act
  rejouer(evenements);
  // Assert
  const enfant = state.nodes.get(`a:${ENFANT}`)!;
  const outil = state.nodes.get('t:toolu_racine')!;
  expect(enfant.startTime).toBe('2026-10-29T22:37:47.153Z');
  expect(enfant.duration).toBe(outil.duration);
  expect(enfant.duration).toBe('8.1s');
});

test('Claude Code : le petit-fils dure autant que l\'outil Agent du sous-agent qui l\'a lancé', () => {
  // Arrange
  const evenements = CLAUDE;
  // Act
  rejouer(evenements);
  // Assert
  const petitFils = state.nodes.get(`a:${PETIT_FILS}`)!;
  const outil = state.nodes.get('t:toolu_enfant')!;
  expect(petitFils.startTime).toBe('2026-10-29T22:37:50.231Z');
  expect(petitFils.duration).toBe(outil.duration);
  expect(petitFils.duration).toBe('3.7s');
});

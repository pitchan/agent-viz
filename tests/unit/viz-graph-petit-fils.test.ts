// Un sous-agent lancé par un sous-agent : il se range sous celui qui l'a lancé, et finit quand il finit.
// Séquences rejouées depuis des sessions réelles (Claude Code 2.1, Codex 0.163), identifiants anonymisés.

import { beforeEach, expect, test } from 'vitest';
import { state, vis } from '../../src/web/viz-state.ts';
import { processEvent, type HookEvent } from '../../src/web/viz-graph.ts';
import { layoutDirtyRoots } from '../../src/web/viz-layout.ts';
import { resetErrors } from '../../src/web/viz-errors.ts';

beforeEach(() => {
  state.nodes.clear();
  state.timelineEntries.length = 0;
  state.eventSeq = 0;
  state.startTimes.clear();
  state.forkedAgentParents.clear();
  vis.nodes.clear();
  vis.runningNodes.clear();
  layoutDirtyRoots.clear();
  resetErrors();
});

const rejouer = (evts: HookEvent[]) => { for (const e of evts) processEvent(e); };

const SID = '00000000-0000-4000-8000-000000000009';
const ENFANT = 'a000000000000e001';
const PETIT_FILS = 'a000000000000f002';

// Ordre et champs relevés dans le fichier d'événements d'une session `claude -p` réelle.
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

test('Claude Code : le petit-fils se range sous le sous-agent qui l\'a lancé, avec son outil', () => {
  // Arrange
  rejouer(CLAUDE);
  // Act
  const petitFils = state.nodes.get(`a:${PETIT_FILS}`)!;
  const enfant = state.nodes.get(`a:${ENFANT}`)!;
  // Assert
  expect(petitFils.parentId).toBe(`a:${ENFANT}`);
  expect(enfant.parentId).toBe(`s:${SID}`);
  expect(enfant.children).toContain(petitFils);
  expect(state.nodes.get(`s:${SID}`)!.children).not.toContain(petitFils);
  expect(petitFils.children.map(c => c.label)).toEqual(['Read']);
});

test('Claude Code : le petit-fils est terminé à la fin de l\'outil Agent de son parent', () => {
  // Arrange
  rejouer(CLAUDE.slice(0, 6));
  // Act
  const petitFils = state.nodes.get(`a:${PETIT_FILS}`)!;
  const enfant = state.nodes.get(`a:${ENFANT}`)!;
  // Assert
  expect(petitFils.status).toBe('done');
  expect(petitFils.endTime).toBe('2026-10-29T22:37:53.950Z');
  expect(enfant.status).toBe('running');
});

const CODEX_SID = '01a00000-0000-7000-8000-000000000009';
const CODEX_ENFANT = '01a00000-0000-7000-8000-00000000e001';
const CODEX_PETIT_FILS = '01a00000-0000-7000-8000-00000000f002';

// Ordre relevé dans le fichier d'événements d'une session `codex exec` réelle ; `parent_agent_id`
// est ce que le hook lit dans l'en-tête du transcript du petit-fils.
const CODEX: HookEvent[] = [
  { hook_event_name: 'SessionStart', session_id: CODEX_SID, _ts: '2026-10-29T22:38:52.722Z' },
  { hook_event_name: 'PreToolUse', session_id: CODEX_SID, tool_name: 'collaborationspawn_agent', tool_use_id: 'call_racine', _ts: '2026-10-29T22:39:00.618Z' },
  { hook_event_name: 'PostToolUse', session_id: CODEX_SID, tool_name: 'collaborationspawn_agent', tool_use_id: 'call_racine', _ts: '2026-10-29T22:39:00.886Z' },
  { hook_event_name: 'PreToolUse', session_id: CODEX_SID, tool_name: 'collaborationwait_agent', tool_use_id: 'call_attente_racine', _ts: '2026-10-29T22:39:03.687Z' },
  { hook_event_name: 'PreToolUse', session_id: CODEX_SID, agent_id: CODEX_ENFANT, agent_type: 'default', agent_name: 'lecture_deleguee', agent_nickname: 'Sagan',
    tool_name: 'collaborationspawn_agent', tool_use_id: 'call_enfant', _ts: '2026-10-29T22:39:03.715Z' },
  { hook_event_name: 'PostToolUse', session_id: CODEX_SID, agent_id: CODEX_ENFANT, agent_type: 'default', agent_name: 'lecture_deleguee', agent_nickname: 'Sagan',
    tool_name: 'collaborationspawn_agent', tool_use_id: 'call_enfant', _ts: '2026-10-29T22:39:03.966Z' },
  { hook_event_name: 'PreToolUse', session_id: CODEX_SID, agent_id: CODEX_ENFANT, agent_type: 'default', agent_name: 'lecture_deleguee', agent_nickname: 'Sagan',
    tool_name: 'collaborationwait_agent', tool_use_id: 'call_attente_enfant', _ts: '2026-10-29T22:39:05.813Z' },
  { hook_event_name: 'PreToolUse', session_id: CODEX_SID, agent_id: CODEX_PETIT_FILS, agent_type: 'default', agent_name: 'lecture_cible', agent_nickname: 'Lovelace',
    parent_agent_id: CODEX_ENFANT, tool_name: 'Bash', tool_use_id: 'exec-lecture', tool_input: { command: 'Get-Content cible.txt' }, _ts: '2026-10-29T22:39:08.840Z' },
  { hook_event_name: 'PostToolUse', session_id: CODEX_SID, agent_id: CODEX_PETIT_FILS, agent_type: 'default', agent_name: 'lecture_cible', agent_nickname: 'Lovelace',
    parent_agent_id: CODEX_ENFANT, tool_name: 'Bash', tool_use_id: 'exec-lecture', _ts: '2026-10-29T22:39:10.156Z' },
  { hook_event_name: 'SubagentStop', session_id: CODEX_SID, agent_id: CODEX_PETIT_FILS,
    started_at: '2026-10-29T22:39:03.966Z', ended_at: '2026-10-29T22:39:12.158Z', _ts: '2026-10-29T22:39:12.158Z' },
];

test('Codex : le petit-fils se range sous le sous-agent qui l\'a lancé, terminé avec ses heures réelles', () => {
  // Arrange
  rejouer(CODEX);
  // Act
  const petitFils = state.nodes.get(`a:${CODEX_PETIT_FILS}`)!;
  const enfant = state.nodes.get(`a:${CODEX_ENFANT}`)!;
  // Assert
  expect(petitFils.parentId).toBe(`a:${CODEX_ENFANT}`);
  expect(enfant.parentId).toBe(`s:${CODEX_SID}`);
  expect(petitFils.label).toBe('lecture_cible');
  expect(petitFils.status).toBe('done');
  expect(petitFils.duration).toBe('8.2s');
  expect(enfant.status).toBe('running');
});

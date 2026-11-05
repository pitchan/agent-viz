// Un sous-agent lancé par un Skill en fork dure autant que ce Skill : la fin du Skill arrive après le
// dernier message du fork et porte son résultat. Séquences rejouées depuis deux sessions réelles
// (Claude Code 2.1.310), identifiants anonymisés, horaires d'origine.

import { beforeEach, expect, test } from 'vitest';
import { state } from '../../src/web/viz-state.ts';
import { processEvent, type HookEvent } from '../../src/web/viz-graph.ts';
import { resetGraph } from '../helpers/viz-graph-events.ts';

beforeEach(resetGraph);

const rejouer = (evts: HookEvent[]) => { for (const e of evts) processEvent(e); };

const SID = '00000000-0000-4000-8000-000000000043';
const FORK = 'a000000000000f043';
const LANCEUR = 'a000000000000e043';

const fork = (hook: string, tool: string, tid: string, ts: string): HookEvent => ({
  hook_event_name: hook, session_id: SID, agent_id: FORK, agent_type: 'Explore',
  tool_name: tool, tool_use_id: tid, tool_input: {}, _ts: ts,
});

// Session 1 : le Skill est appelé depuis la conversation.
const DEPUIS_LA_CONVERSATION: HookEvent[] = [
  { hook_event_name: 'SessionStart', session_id: SID, _ts: '2026-10-30T10:32:05.850Z' },
  { hook_event_name: 'PreToolUse', session_id: SID, tool_name: 'Skill', tool_use_id: 'toolu_skill',
    tool_input: { skill: 'compter-fichiers' }, _ts: '2026-10-30T10:32:10.454Z' },
  fork('PreToolUse', 'Glob', 'toolu_f1', '2026-10-30T10:32:13.307Z'),
  fork('PostToolUse', 'Glob', 'toolu_f1', '2026-10-30T10:32:13.862Z'),
  fork('PreToolUse', 'Read', 'toolu_f2', '2026-10-30T10:32:15.863Z'),
  fork('PreToolUse', 'Read', 'toolu_f3', '2026-10-30T10:32:16.308Z'),
  fork('PostToolUse', 'Read', 'toolu_f2', '2026-10-30T10:32:16.343Z'),
  fork('PostToolUse', 'Read', 'toolu_f3', '2026-10-30T10:32:16.601Z'),
  { hook_event_name: 'PostToolUse', session_id: SID, tool_name: 'Skill', tool_use_id: 'toolu_skill',
    tool_input: { skill: 'compter-fichiers' }, tool_response: { status: 'forked', agentId: FORK },
    _ts: '2026-10-30T10:32:18.628Z' },
  { hook_event_name: 'PreToolUse', session_id: SID, tool_name: 'Glob', tool_use_id: 'toolu_g',
    tool_input: {}, _ts: '2026-10-30T10:32:18.739Z' },
  { hook_event_name: 'PostToolUse', session_id: SID, tool_name: 'Glob', tool_use_id: 'toolu_g',
    tool_input: {}, _ts: '2026-10-30T10:32:18.899Z' },
  { hook_event_name: 'Stop', session_id: SID, _ts: '2026-10-30T10:32:23.897Z' },
];

const lanceur = (hook: string, tool: string, tid: string, ts: string, extra: Partial<HookEvent> = {}): HookEvent => ({
  hook_event_name: hook, session_id: SID, agent_id: LANCEUR, agent_type: 'general-purpose',
  tool_name: tool, tool_use_id: tid, _ts: ts, ...extra,
});

// Session 2 : le Skill est appelé par un sous-agent, lui-même lancé par l'outil Agent.
const DEPUIS_UN_SOUS_AGENT: HookEvent[] = [
  { hook_event_name: 'SessionStart', session_id: SID, _ts: '2026-10-30T10:34:55.603Z' },
  { hook_event_name: 'PreToolUse', session_id: SID, tool_name: 'Agent', tool_use_id: 'toolu_agent',
    tool_input: { description: 'Exécuter skill compter-fichiers' }, _ts: '2026-10-30T10:35:01.310Z' },
  lanceur('PreToolUse', 'Skill', 'toolu_skill', '2026-10-30T10:35:03.810Z', { tool_input: { skill: 'compter-fichiers' } }),
  fork('PreToolUse', 'Glob', 'toolu_f1', '2026-10-30T10:35:06.046Z'),
  fork('PostToolUse', 'Glob', 'toolu_f1', '2026-10-30T10:35:06.295Z'),
  fork('PreToolUse', 'Read', 'toolu_f2', '2026-10-30T10:35:08.360Z'),
  fork('PostToolUse', 'Read', 'toolu_f2', '2026-10-30T10:35:08.520Z'),
  fork('PreToolUse', 'Read', 'toolu_f3', '2026-10-30T10:35:08.855Z'),
  fork('PostToolUse', 'Read', 'toolu_f3', '2026-10-30T10:35:09.034Z'),
  lanceur('PostToolUse', 'Skill', 'toolu_skill', '2026-10-30T10:35:11.868Z', {
    tool_input: { skill: 'compter-fichiers' }, tool_response: { status: 'forked', agentId: FORK },
  }),
  { hook_event_name: 'PostToolUse', session_id: SID, tool_name: 'Agent', tool_use_id: 'toolu_agent',
    tool_input: { description: 'Exécuter skill compter-fichiers' },
    tool_response: { status: 'completed', agentId: LANCEUR }, _ts: '2026-10-30T10:35:15.625Z' },
  { hook_event_name: 'Stop', session_id: SID, _ts: '2026-10-30T10:35:21.651Z' },
];

test('Skill en fork depuis la conversation : le sous-agent va du début à la fin du Skill', () => {
  // Arrange
  const evenements = DEPUIS_LA_CONVERSATION;
  // Act
  rejouer(evenements);
  // Assert
  const sousAgent = state.nodes.get(`a:${FORK}`)!;
  const skill = state.nodes.get('t:toolu_skill')!;
  expect(sousAgent.startTime).toBe('2026-10-30T10:32:10.454Z');
  expect(sousAgent.endTime).toBe('2026-10-30T10:32:18.628Z');
  expect(sousAgent.status).toBe('done');
  expect(sousAgent.duration).toBe(skill.duration);
});

test('Skill en fork : le sous-agent est fermé dès la fin du Skill, avant la fin du tour', () => {
  // Arrange
  const avantLaFinDuTour = DEPUIS_LA_CONVERSATION.slice(0, -1);
  // Act
  rejouer(avantLaFinDuTour);
  // Assert
  const sousAgent = state.nodes.get(`a:${FORK}`)!;
  expect(sousAgent.status).toBe('done');
  expect(sousAgent.endTime).toBe('2026-10-30T10:32:18.628Z');
});

test('Skill en fork depuis un sous-agent : le fork tient dans son lanceur et dure autant que le Skill', () => {
  // Arrange
  const evenements = DEPUIS_UN_SOUS_AGENT;
  // Act
  rejouer(evenements);
  // Assert
  const sousAgent = state.nodes.get(`a:${FORK}`)!;
  const parent = state.nodes.get(`a:${LANCEUR}`)!;
  const skill = state.nodes.get('t:toolu_skill')!;
  expect(sousAgent.parentId).toBe(`a:${LANCEUR}`);
  expect(sousAgent.startTime).toBe('2026-10-30T10:35:03.810Z');
  expect(sousAgent.endTime).toBe('2026-10-30T10:35:11.868Z');
  expect(sousAgent.duration).toBe(skill.duration);
  expect(Date.parse(sousAgent.startTime!)).toBeGreaterThanOrEqual(Date.parse(parent.startTime!));
  expect(Date.parse(sousAgent.endTime!)).toBeLessThanOrEqual(Date.parse(parent.endTime!));
});

test('Skill en fork depuis un sous-agent : le lanceur garde les bornes de son outil Agent', () => {
  // Arrange
  const evenements = DEPUIS_UN_SOUS_AGENT;
  // Act
  rejouer(evenements);
  // Assert
  const parent = state.nodes.get(`a:${LANCEUR}`)!;
  expect(parent.startTime).toBe('2026-10-30T10:35:01.310Z');
  expect(parent.endTime).toBe('2026-10-30T10:35:15.625Z');
  expect(parent.duration).toBe(state.nodes.get('t:toolu_agent')!.duration);
  expect(parent.sub).toBe('Exécuter skill compter-fichiers');
});

test('Skill sans fork : aucun sous-agent n\'est touché', () => {
  // Arrange
  const evenements: HookEvent[] = [
    { hook_event_name: 'SessionStart', session_id: SID, _ts: '2026-10-30T10:32:05.850Z' },
    { hook_event_name: 'PreToolUse', session_id: SID, tool_name: 'Agent', tool_use_id: 'toolu_agent',
      tool_input: { description: 'Lire' }, _ts: '2026-10-30T10:32:06.000Z' },
    lanceur('PreToolUse', 'Read', 'toolu_r', '2026-10-30T10:32:08.000Z', { tool_input: {} }),
    { hook_event_name: 'PreToolUse', session_id: SID, tool_name: 'Skill', tool_use_id: 'toolu_skill',
      tool_input: { skill: 'en-ligne' }, _ts: '2026-10-30T10:32:09.000Z' },
    { hook_event_name: 'PostToolUse', session_id: SID, tool_name: 'Skill', tool_use_id: 'toolu_skill',
      tool_input: { skill: 'en-ligne' }, tool_response: { agentId: LANCEUR }, _ts: '2026-10-30T10:32:10.000Z' },
  ];
  // Act
  rejouer(evenements);
  // Assert
  const sousAgent = state.nodes.get(`a:${LANCEUR}`)!;
  expect(sousAgent.status).toBe('running');
  expect(sousAgent.startTime).toBe('2026-10-30T10:32:08.000Z');
  expect(sousAgent.endTime).toBeNull();
});

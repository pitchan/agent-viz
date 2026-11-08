// Le début d'un sous-agent Codex, que le hook tire du transcript du fil qui l'a lancé, sur des
// séquences d'événements relevées sur de vraies sessions Codex (identifiants, surnoms et commandes
// neutralisés ; ordre, heures et champs conservés). Le début s'écrit avec la fin de `spawn_agent`.

import { beforeEach, expect, test } from 'vitest';
import { state, vis } from '../../src/web/viz-state.ts';
import { processEvent, type HookEvent } from '../../src/web/viz-graph.ts';
import { layoutDirtyRoots } from '../../src/web/viz-layout.ts';
import { resetErrors } from '../../src/web/viz-errors.ts';

const SID = 'codex-session-0002';

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

function ev(ts: string, hook_event_name: string, extra: Partial<HookEvent> = {}): HookEvent {
  return { session_id: SID, hook_event_name, _ts: ts, ...extra };
}

function main(ts: string, name: string, id: string, tool: string): HookEvent {
  return ev(ts, name, { tool_name: tool, tool_use_id: id, tool_input: {} });
}

function child(ts: string, name: string, agent: string, nick: string, task: string, id: string, command: string): HookEvent {
  return ev(ts, name, {
    agent_id: agent, agent_name: task, agent_nickname: nick,
    tool_name: 'Bash', tool_use_id: id, tool_input: { command },
  });
}

function start(ts: string, agent: string, nick: string, task: string, started_at: string, parent?: string): HookEvent {
  const extra: Partial<HookEvent> = { agent_id: agent, agent_name: task, agent_nickname: nick, started_at };
  if (parent) extra.parent_agent_id = parent;
  return ev(ts, 'SubagentStart', extra);
}

function stop(ts: string, agent: string, started_at: string, ended_at: string): HookEvent {
  return ev(ts, 'SubagentStop', { agent_id: agent, started_at, ended_at });
}

// A répond sans outil ; B lance une commande. Lancés l'un après l'autre.
const A = 'agent-a-0005', B = 'agent-b-0006';
const SANS_OUTIL: HookEvent[] = [
  ev('2026-10-30T09:44:41.315Z', 'SessionStart'),
  ev('2026-10-30T09:44:42.423Z', 'UserPromptSubmit'),
  main('2026-10-30T09:44:47.307Z', 'PreToolUse', 'call-spawn-a', 'collaborationspawn_agent'),
  start('2026-10-30T09:44:48.753Z', A, 'Epsilon', 'a', '2026-10-30T09:44:47.430Z'),
  main('2026-10-30T09:44:48.753Z', 'PostToolUse', 'call-spawn-a', 'collaborationspawn_agent'),
  stop('2026-10-30T09:44:53.100Z', A, '2026-10-30T09:44:47.430Z', '2026-10-30T09:44:50.773Z'),
  main('2026-10-30T09:44:53.100Z', 'PreToolUse', 'call-spawn-b', 'collaborationspawn_agent'),
  start('2026-10-30T09:44:53.711Z', B, 'Zeta', 'b', '2026-10-30T09:44:53.141Z'),
  main('2026-10-30T09:44:53.711Z', 'PostToolUse', 'call-spawn-b', 'collaborationspawn_agent'),
  main('2026-10-30T09:44:56.491Z', 'PreToolUse', 'call-wait-1', 'collaborationwait_agent'),
  child('2026-10-30T09:44:58.689Z', 'PreToolUse', B, 'Zeta', 'b', 'exec-b-1', 'echo beta'),
  child('2026-10-30T09:45:02.202Z', 'PostToolUse', B, 'Zeta', 'b', 'exec-b-1', 'echo beta'),
  stop('2026-10-30T09:45:05.781Z', B, '2026-10-30T09:44:53.141Z', '2026-10-30T09:45:05.205Z'),
  main('2026-10-30T09:45:05.781Z', 'PostToolUse', 'call-wait-1', 'collaborationwait_agent'),
  ev('2026-10-30T09:45:08.336Z', 'Stop'),
];

test('un sous-agent Codex qui n appelle aucun outil apparaît, terminé, sous son surnom et avec ses heures réelles', () => {
  // Arrange
  const events = SANS_OUTIL;
  // Act
  for (const e of events) processEvent(e);
  // Assert
  expect(state.nodes.get(`a:${A}`)).toMatchObject({
    type: 'agent', label: 'a', sub: 'Epsilon', status: 'done', parentId: `s:${SID}`,
    startTime: '2026-10-30T09:44:47.430Z', endTime: '2026-10-30T09:44:50.773Z',
  });
});

test('un sous-agent Codex apparaît dès son lancement, avant son premier outil', () => {
  // Arrange — jusqu'au début de B, avant la fin de son lancement.
  const events = SANS_OUTIL.slice(0, 8);
  // Act
  for (const e of events) processEvent(e);
  // Assert
  expect(state.nodes.get(`a:${B}`)).toMatchObject({
    type: 'agent', label: 'b', sub: 'Zeta', status: 'running', startTime: '2026-10-30T09:44:53.141Z',
  });
});

test('deux sous-agents Codex lancés ensemble portent la pastille dès le lancement du second', () => {
  // Arrange — A tourne de :32.8 à :37.6, B part à :36.2 : la séquence s'arrête au début de B.
  const C = 'agent-a-0001', D = 'agent-b-0002';
  const events: HookEvent[] = [
    ev('2026-10-29T22:40:29.623Z', 'SessionStart'),
    ev('2026-10-29T22:40:29.866Z', 'UserPromptSubmit'),
    main('2026-10-29T22:40:32.744Z', 'PreToolUse', 'call-spawn-a', 'collaborationspawn_agent'),
    start('2026-10-29T22:40:33.072Z', C, 'Alpha', 'a', '2026-10-29T22:40:32.841Z'),
    main('2026-10-29T22:40:33.072Z', 'PostToolUse', 'call-spawn-a', 'collaborationspawn_agent'),
    child('2026-10-29T22:40:35.680Z', 'PreToolUse', C, 'Alpha', 'a', 'exec-a-1', 'echo alpha'),
    main('2026-10-29T22:40:36.125Z', 'PreToolUse', 'call-spawn-b', 'collaborationspawn_agent'),
    child('2026-10-29T22:40:36.470Z', 'PostToolUse', C, 'Alpha', 'a', 'exec-a-1', 'echo alpha'),
    start('2026-10-29T22:40:36.504Z', D, 'Beta', 'b', '2026-10-29T22:40:36.244Z'),
  ];
  // Act
  for (const e of events) processEvent(e);
  // Assert
  expect([state.nodes.get(`a:${C}`)?.isParallel, state.nodes.get(`a:${D}`)?.isParallel]).toEqual([true, true]);
});

test('un sous-agent Codex lancé par un sous-agent démarre sous son lanceur', () => {
  // Arrange
  const P = 'agent-p-0007', F = 'agent-f-0008';
  const events: HookEvent[] = [
    ev('2026-10-30T09:44:41.315Z', 'SessionStart'),
    start('2026-10-30T09:44:48.753Z', P, 'Eta', 'audit', '2026-10-30T09:44:47.430Z'),
    start('2026-10-30T09:44:52.000Z', F, 'Theta', 'relecture', '2026-10-30T09:44:51.500Z', P),
  ];
  // Act
  for (const e of events) processEvent(e);
  // Assert
  expect(state.nodes.get(`a:${F}`)?.parentId).toBe(`a:${P}`);
});

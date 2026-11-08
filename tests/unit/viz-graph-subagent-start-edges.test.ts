// Les cas limites du début d'un sous-agent Codex : un début réécrit après la fin, un lanceur
// inconnu du graphe, un début sans surnom. Heures et formes reprises d'une session Codex réelle.

import { beforeEach, expect, test } from 'vitest';
import { state, vis } from '../../src/web/viz-state.ts';
import { processEvent, type HookEvent } from '../../src/web/viz-graph.ts';
import { layoutDirtyRoots } from '../../src/web/viz-layout.ts';
import { resetErrors } from '../../src/web/viz-errors.ts';

const SID = 'codex-session-0003';
const A = 'agent-a-0009';

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

function start(ts: string, extra: Partial<HookEvent> = {}): HookEvent {
  return ev(ts, 'SubagentStart', { agent_id: A, agent_name: 'a', agent_nickname: 'Iota', started_at: '2026-10-30T09:44:47.430Z', ...extra });
}

const STOP = ev('2026-10-30T09:44:53.100Z', 'SubagentStop', { agent_id: A, started_at: '2026-10-30T09:44:47.430Z', ended_at: '2026-10-30T09:44:50.773Z' });

test('un début réécrit après la fin d un sous-agent ne le rouvre pas', () => {
  // Arrange
  const events = [ev('2026-10-30T09:44:41.315Z', 'SessionStart'), start('2026-10-30T09:44:48.753Z'), STOP, start('2026-10-30T09:44:56.491Z')];
  // Act
  for (const e of events) processEvent(e);
  // Assert
  expect(state.nodes.get(`a:${A}`)).toMatchObject({ status: 'done', startTime: '2026-10-30T09:44:47.430Z', endTime: '2026-10-30T09:44:50.773Z' });
});

test('un début réécrit n ajoute pas une seconde entrée au fil d activité', () => {
  // Arrange
  const events = [ev('2026-10-30T09:44:41.315Z', 'SessionStart'), start('2026-10-30T09:44:48.753Z'), STOP, start('2026-10-30T09:44:56.491Z')];
  // Act
  for (const e of events) processEvent(e);
  // Assert
  expect(state.timelineEntries.filter(e => e.nodeId === `a:${A}`)).toHaveLength(1);
});

test('un sous-agent dont le lanceur est inconnu du graphe démarre sous la session, sans nœud fantôme', () => {
  // Arrange
  const events = [ev('2026-10-30T09:44:41.315Z', 'SessionStart'), start('2026-10-30T09:44:48.753Z', { parent_agent_id: 'agent-inconnu' })];
  // Act
  for (const e of events) processEvent(e);
  // Assert
  expect([state.nodes.get(`a:${A}`)?.parentId, state.nodes.has('a:agent-inconnu')]).toEqual([`s:${SID}`, false]);
});

test('un sous-agent démarré sans surnom prend celui que porte son premier outil', () => {
  // Arrange
  const sansSurnom = start('2026-10-30T09:44:48.753Z', { agent_nickname: undefined });
  const outil = ev('2026-10-30T09:44:58.689Z', 'PreToolUse', {
    agent_id: A, agent_name: 'a', agent_nickname: 'Iota', tool_name: 'Bash', tool_use_id: 'exec-a-1', tool_input: { command: 'echo a' },
  });
  // Act
  for (const e of [ev('2026-10-30T09:44:41.315Z', 'SessionStart'), sansSurnom, outil]) processEvent(e);
  // Assert
  expect(state.nodes.get(`a:${A}`)?.sub).toBe('Iota');
});

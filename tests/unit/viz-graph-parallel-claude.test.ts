// La pastille « parallèle » des sous-agents Claude Code : le nœud naît au premier outil
// portant `agent_id`, et finit au PostToolUse de l'outil `Agent` du fil principal.

import { beforeEach, expect, test } from 'vitest';
import { processEvent, type HookEvent } from '../../src/web/viz-graph.ts';
import { ev, parallelFlags, resetGraph } from '../helpers/viz-graph-events.ts';

beforeEach(resetGraph);

function agentTool(ts: string, name: string, id: string, agentId?: string): HookEvent {
  return ev(ts, name, {
    tool_name: 'Agent', tool_use_id: id, tool_input: { description: 'tâche' },
    ...(agentId ? { tool_response: { agentId } } : {}),
  });
}

function childTool(ts: string, name: string, agent: string, id: string): HookEvent {
  return ev(ts, name, { agent_id: agent, agent_type: 'general-purpose', tool_name: 'Read', tool_use_id: id, tool_input: {} });
}

test('deux sous-agents Claude Code en cours en même temps portent tous deux la pastille', () => {
  // Arrange
  const events: HookEvent[] = [
    ev('2026-01-01T10:00:00.000Z', 'SessionStart'),
    agentTool('2026-01-01T10:00:01.000Z', 'PreToolUse', 'toolu-a'),
    agentTool('2026-01-01T10:00:01.100Z', 'PreToolUse', 'toolu-b'),
    childTool('2026-01-01T10:00:02.000Z', 'PreToolUse', 'agent-a', 'toolu-a1'),
    childTool('2026-01-01T10:00:02.500Z', 'PreToolUse', 'agent-b', 'toolu-b1'),
  ];

  // Act
  for (const e of events) processEvent(e);

  // Assert
  expect(parallelFlags()).toEqual({ 'agent-a': true, 'agent-b': true });
});

test('deux sous-agents Claude Code lancés l un après l autre ne portent pas la pastille', () => {
  // Arrange
  const events: HookEvent[] = [
    ev('2026-01-01T10:00:00.000Z', 'SessionStart'),
    agentTool('2026-01-01T10:00:01.000Z', 'PreToolUse', 'toolu-a'),
    childTool('2026-01-01T10:00:02.000Z', 'PreToolUse', 'agent-a', 'toolu-a1'),
    childTool('2026-01-01T10:00:03.000Z', 'PostToolUse', 'agent-a', 'toolu-a1'),
    agentTool('2026-01-01T10:00:04.000Z', 'PostToolUse', 'toolu-a', 'agent-a'),
    agentTool('2026-01-01T10:00:05.000Z', 'PreToolUse', 'toolu-b'),
    childTool('2026-01-01T10:00:06.000Z', 'PreToolUse', 'agent-b', 'toolu-b1'),
    childTool('2026-01-01T10:00:07.000Z', 'PostToolUse', 'agent-b', 'toolu-b1'),
    agentTool('2026-01-01T10:00:08.000Z', 'PostToolUse', 'toolu-b', 'agent-b'),
  ];

  // Act
  for (const e of events) processEvent(e);

  // Assert
  expect(parallelFlags()).toEqual({ 'agent-a': false, 'agent-b': false });
});

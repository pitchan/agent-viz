// La pastille « parallèle » exige un vrai chevauchement : un sous-agent lancé à l'instant
// exact où son frère finit ne tourne pas en même temps que lui.

import { beforeEach, expect, test } from 'vitest';
import { processEvent, type HookEvent } from '../../src/web/viz-graph.ts';
import { ev, parallelFlags, resetGraph } from '../helpers/viz-graph-events.ts';

beforeEach(resetGraph);

function childTool(ts: string, name: string, agent: string, id: string): HookEvent {
  return ev(ts, name, { agent_id: agent, agent_name: agent, tool_name: 'Bash', tool_use_id: id, tool_input: { command: 'echo' } });
}

test('un sous-agent Codex lancé à la seconde où son frère finit ne porte pas la pastille', () => {
  // Arrange — la fin réelle de A et le début réel de B tombent sur la même milliseconde.
  const events: HookEvent[] = [
    ev('2026-01-01T10:00:00.000Z', 'SessionStart'),
    childTool('2026-01-01T10:00:02.000Z', 'PreToolUse', 'agent-a', 'exec-a1'),
    childTool('2026-01-01T10:00:02.500Z', 'PostToolUse', 'agent-a', 'exec-a1'),
    ev('2026-01-01T10:00:04.000Z', 'SubagentStop', {
      agent_id: 'agent-a', started_at: '2026-01-01T10:00:01.000Z', ended_at: '2026-01-01T10:00:03.000Z',
    }),
    childTool('2026-01-01T10:00:05.000Z', 'PreToolUse', 'agent-b', 'exec-b1'),
    childTool('2026-01-01T10:00:05.500Z', 'PostToolUse', 'agent-b', 'exec-b1'),
    ev('2026-01-01T10:00:07.000Z', 'SubagentStop', {
      agent_id: 'agent-b', started_at: '2026-01-01T10:00:03.000Z', ended_at: '2026-01-01T10:00:06.000Z',
    }),
  ];

  // Act
  for (const e of events) processEvent(e);

  // Assert
  expect(parallelFlags()).toEqual({ 'agent-a': false, 'agent-b': false });
});

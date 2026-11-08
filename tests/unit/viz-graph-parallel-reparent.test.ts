// La pastille « parallèle » suit les frères actuels d'un agent. Un sous-agent lancé par un
// Skill en fork naît d'abord sous la Session, à côté de l'agent qui l'a lancé, puis rejoint
// ce dernier : il n'a alors plus de frère, et aucun des deux ne tourne en parallèle.

import { beforeEach, expect, test } from 'vitest';
import { processEvent, type HookEvent } from '../../src/web/viz-graph.ts';
import { ev, parallelFlags, resetGraph } from '../helpers/viz-graph-events.ts';

beforeEach(resetGraph);

test('un sous-agent rattaché sous l agent qui l a lancé en fork perd la pastille, et son parent aussi', () => {
  // Arrange
  const events: HookEvent[] = [
    ev('2026-01-01T10:00:00.000Z', 'SessionStart'),
    ev('2026-01-01T10:00:01.000Z', 'PreToolUse', {
      agent_id: 'agent-parent', agent_type: 'general-purpose', tool_name: 'Skill', tool_use_id: 'toolu-skill', tool_input: { skill: 'revue' },
    }),
    ev('2026-01-01T10:00:02.000Z', 'PreToolUse', {
      agent_id: 'agent-fork', agent_type: 'revue', tool_name: 'Read', tool_use_id: 'toolu-f1', tool_input: {},
    }),
    ev('2026-01-01T10:00:03.000Z', 'PostToolUse', {
      agent_id: 'agent-parent', tool_name: 'Skill', tool_use_id: 'toolu-skill', tool_input: { skill: 'revue' },
      tool_response: { status: 'forked', agentId: 'agent-fork' },
    }),
  ];

  // Act
  for (const e of events) processEvent(e);

  // Assert
  expect(parallelFlags()).toEqual({ 'agent-parent': false, 'agent-fork': false });
});

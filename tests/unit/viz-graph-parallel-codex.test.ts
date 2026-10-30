// La pastille « parallèle » des sous-agents Codex, sur des séquences d'événements relevées
// sur de vraies sessions Codex (identifiants, surnoms et commandes neutralisés ; ordre,
// heures et champs conservés). Codex n'émet pas de début de sous-agent : le nœud naît au
// premier outil, et l'heure réelle du lancement n'arrive qu'avec la fin (`started_at`).

import { beforeEach, expect, test } from 'vitest';
import { state, vis } from '../../src/web/viz-state.ts';
import { processEvent, type HookEvent } from '../../src/web/viz-graph.ts';
import { layoutDirtyRoots } from '../../src/web/viz-layout.ts';
import { resetErrors } from '../../src/web/viz-errors.ts';

const SID = 'codex-session-0001';

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

// Un outil du fil principal : lancement ou attente d'un sous-agent.
function main(ts: string, name: string, id: string, tool: string): HookEvent {
  return ev(ts, name, { tool_name: tool, tool_use_id: id, tool_input: {} });
}

// Un outil exécuté par un sous-agent : c'est lui qui fait naître le nœud de l'agent.
function child(ts: string, name: string, agent: string, nick: string, task: string, id: string, command: string): HookEvent {
  return ev(ts, name, {
    agent_id: agent, agent_name: task, agent_nickname: nick,
    tool_name: 'Bash', tool_use_id: id, tool_input: { command },
  });
}

// La fin qu'agent-viz déduit du transcript du fil principal, avec les heures réelles du passage.
function stop(ts: string, agent: string, started_at: string, ended_at: string): HookEvent {
  return ev(ts, 'SubagentStop', { agent_id: agent, started_at, ended_at });
}

function parallelFlags(): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const n of state.nodes.values()) if (n.type === 'agent') out[n.sub] = n.isParallel;
  return out;
}

test('deux sous-agents Codex lancés ensemble portent la pastille, même si le second ne fait son premier outil qu après la fin du premier', () => {
  // Arrange — A tourne de :32.8 à :37.6, B de :36.2 à 41:05.6 : leurs passages se chevauchent.
  const A = 'agent-a-0001', B = 'agent-b-0002';
  const events: HookEvent[] = [
    ev('2026-10-29T22:40:29.623Z', 'SessionStart'),
    ev('2026-10-29T22:40:29.866Z', 'UserPromptSubmit'),
    main('2026-10-29T22:40:32.744Z', 'PreToolUse', 'call-spawn-a', 'collaborationspawn_agent'),
    main('2026-10-29T22:40:33.072Z', 'PostToolUse', 'call-spawn-a', 'collaborationspawn_agent'),
    child('2026-10-29T22:40:35.680Z', 'PreToolUse', A, 'Alpha', 'a', 'exec-a-1', 'echo alpha'),
    main('2026-10-29T22:40:36.125Z', 'PreToolUse', 'call-spawn-b', 'collaborationspawn_agent'),
    child('2026-10-29T22:40:36.470Z', 'PostToolUse', A, 'Alpha', 'a', 'exec-a-1', 'echo alpha'),
    main('2026-10-29T22:40:36.504Z', 'PostToolUse', 'call-spawn-b', 'collaborationspawn_agent'),
    stop('2026-10-29T22:40:39.320Z', A, '2026-10-29T22:40:32.841Z', '2026-10-29T22:40:37.616Z'),
    main('2026-10-29T22:40:39.320Z', 'PreToolUse', 'call-wait-1', 'collaborationwait_agent'),
    main('2026-10-29T22:40:39.623Z', 'PostToolUse', 'call-wait-1', 'collaborationwait_agent'),
    main('2026-10-29T22:40:41.495Z', 'PreToolUse', 'call-wait-2', 'collaborationwait_agent'),
    main('2026-10-29T22:40:51.728Z', 'PostToolUse', 'call-wait-2', 'collaborationwait_agent'),
    main('2026-10-29T22:40:53.188Z', 'PreToolUse', 'call-wait-3', 'collaborationwait_agent'),
    child('2026-10-29T22:41:03.460Z', 'PreToolUse', B, 'Beta', 'b', 'exec-b-1', 'echo beta'),
    main('2026-10-29T22:41:03.492Z', 'PostToolUse', 'call-wait-3', 'collaborationwait_agent'),
    child('2026-10-29T22:41:04.019Z', 'PostToolUse', B, 'Beta', 'b', 'exec-b-1', 'echo beta'),
    main('2026-10-29T22:41:05.520Z', 'PreToolUse', 'call-wait-4', 'collaborationwait_agent'),
    stop('2026-10-29T22:41:05.770Z', B, '2026-10-29T22:40:36.244Z', '2026-10-29T22:41:05.558Z'),
    main('2026-10-29T22:41:05.770Z', 'PostToolUse', 'call-wait-4', 'collaborationwait_agent'),
    ev('2026-10-29T22:41:08.056Z', 'Stop'),
  ];

  // Act
  for (const e of events) processEvent(e);

  // Assert
  expect(parallelFlags()).toEqual({ Alpha: true, Beta: true });
});

test('deux sous-agents Codex lancés l un après l autre ne portent pas la pastille', () => {
  // Arrange — A tourne de :27.1 à :35.5, B de :37.7 à :43.2 : aucun chevauchement.
  const A = 'agent-a-0003', B = 'agent-b-0004';
  const events: HookEvent[] = [
    ev('2026-10-29T22:42:22.770Z', 'SessionStart'),
    ev('2026-10-29T22:42:23.511Z', 'UserPromptSubmit'),
    main('2026-10-29T22:42:26.940Z', 'PreToolUse', 'call-spawn-a', 'collaborationspawn_agent'),
    main('2026-10-29T22:42:27.660Z', 'PostToolUse', 'call-spawn-a', 'collaborationspawn_agent'),
    main('2026-10-29T22:42:30.217Z', 'PreToolUse', 'call-wait-1', 'collaborationwait_agent'),
    child('2026-10-29T22:42:32.075Z', 'PreToolUse', A, 'Gamma', 'a', 'exec-a-1', 'echo gamma'),
    child('2026-10-29T22:42:33.000Z', 'PostToolUse', A, 'Gamma', 'a', 'exec-a-1', 'echo gamma'),
    stop('2026-10-29T22:42:35.720Z', A, '2026-10-29T22:42:27.100Z', '2026-10-29T22:42:35.472Z'),
    main('2026-10-29T22:42:35.720Z', 'PostToolUse', 'call-wait-1', 'collaborationwait_agent'),
    main('2026-10-29T22:42:37.642Z', 'PreToolUse', 'call-spawn-b', 'collaborationspawn_agent'),
    main('2026-10-29T22:42:37.945Z', 'PostToolUse', 'call-spawn-b', 'collaborationspawn_agent'),
    main('2026-10-29T22:42:39.447Z', 'PreToolUse', 'call-wait-2', 'collaborationwait_agent'),
    child('2026-10-29T22:42:40.552Z', 'PreToolUse', B, 'Delta', 'b', 'exec-b-1', 'echo delta'),
    child('2026-10-29T22:42:41.203Z', 'PostToolUse', B, 'Delta', 'b', 'exec-b-1', 'echo delta'),
    stop('2026-10-29T22:42:43.382Z', B, '2026-10-29T22:42:37.734Z', '2026-10-29T22:42:43.162Z'),
    main('2026-10-29T22:42:43.382Z', 'PostToolUse', 'call-wait-2', 'collaborationwait_agent'),
    ev('2026-10-29T22:42:45.303Z', 'Stop'),
  ];

  // Act
  for (const e of events) processEvent(e);

  // Assert
  expect(parallelFlags()).toEqual({ Gamma: false, Delta: false });
});

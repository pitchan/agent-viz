// Un sous-agent Claude Code lancé en arrière-plan puis arrêté par TaskStop ne reçoit aucun hook de
// fin : la réponse de TaskStop, qui nomme la tâche arrêtée, est sa fin. Séquence rejouée depuis une
// session réelle (Claude Code 2.1.310), identifiants anonymisés, horaires d'origine.

import { beforeEach, expect, test } from 'vitest';
import { state, vis } from '../../src/web/viz-state.ts';
import { processEvent, type HookEvent } from '../../src/web/viz-graph.ts';
import { resetGraph } from '../helpers/viz-graph-events.ts';

beforeEach(resetGraph);

const rejouer = (evts: HookEvent[]) => { for (const e of evts) processEvent(e); };

const SID = '00000000-0000-4000-8000-000000000046';
const ARRIERE_PLAN = 'a000000000000b046';
const ARRET = '2026-10-30T10:46:17.145Z';
const FIN_DU_TOUR = '2026-10-30T10:50:58.592Z';

const sousAgent = (hook: string, tool: string, tid: string, ts: string): HookEvent => ({
  hook_event_name: hook, session_id: SID, agent_id: ARRIERE_PLAN, agent_type: 'general-purpose',
  tool_name: tool, tool_use_id: tid, tool_input: {}, _ts: ts,
});

const principal = (hook: string, tool: string, tid: string, ts: string, extra: Partial<HookEvent> = {}): HookEvent => ({
  hook_event_name: hook, session_id: SID, tool_name: tool, tool_use_id: tid, _ts: ts, ...extra,
});

const stopTask = (taskId: string, taskType: string): HookEvent['tool_response'] => ({
  message: `Successfully stopped task: ${taskId}`, task_id: taskId, task_type: taskType, command: 'Corriger',
});

const LANCEMENT: HookEvent[] = [
  { hook_event_name: 'SessionStart', session_id: SID, _ts: '2026-10-30T10:44:40.000Z' },
  principal('PreToolUse', 'Agent', 'toolu_agent', '2026-10-30T10:44:57.890Z',
    { tool_input: { description: 'Corriger', run_in_background: true } }),
  principal('PostToolUse', 'Agent', 'toolu_agent', '2026-10-30T10:45:03.858Z', {
    tool_input: { description: 'Corriger', run_in_background: true },
    tool_response: { status: 'async_launched', agentId: ARRIERE_PLAN },
  }),
  sousAgent('PreToolUse', 'Read', 'toolu_s1', '2026-10-30T10:45:10.177Z'),
  sousAgent('PostToolUse', 'Read', 'toolu_s1', '2026-10-30T10:45:11.494Z'),
  sousAgent('PreToolUse', 'Bash', 'toolu_s2', '2026-10-30T10:46:14.522Z'),
  sousAgent('PostToolUse', 'Bash', 'toolu_s2', '2026-10-30T10:46:15.902Z'),
];

const ARRET_PAR_TASKSTOP: HookEvent[] = [
  principal('PreToolUse', 'TaskStop', 'toolu_stop', '2026-10-30T10:46:17.048Z', { tool_input: { task_id: ARRIERE_PLAN } }),
  principal('PostToolUse', 'TaskStop', 'toolu_stop', ARRET, {
    tool_input: { task_id: ARRIERE_PLAN }, tool_response: stopTask(ARRIERE_PLAN, 'local_agent'),
  }),
];

const FIN: HookEvent[] = [{ hook_event_name: 'Stop', session_id: SID, _ts: FIN_DU_TOUR }];

test('TaskStop : le sous-agent arrêté est fermé à la fin de TaskStop', () => {
  // Arrange
  const evenements = [...LANCEMENT, ...ARRET_PAR_TASKSTOP];
  // Act
  rejouer(evenements);
  // Assert
  const n = state.nodes.get(`a:${ARRIERE_PLAN}`)!;
  expect(n.status).toBe('done');
  expect(n.endTime).toBe(ARRET);
  expect(n.duration).not.toBeNull();
  expect(vis.runningNodes.has(n.id)).toBe(false);
});

test('TaskStop puis fin du tour : le sous-agent garde l\'heure de son arrêt', () => {
  // Arrange
  const evenements = [...LANCEMENT, ...ARRET_PAR_TASKSTOP, ...FIN];
  // Act
  rejouer(evenements);
  // Assert
  const n = state.nodes.get(`a:${ARRIERE_PLAN}`)!;
  expect(n.status).toBe('done');
  expect(n.endTime).toBe(ARRET);
});

test('TaskStop d\'une commande en arrière-plan : aucun sous-agent n\'est touché', () => {
  // Arrange
  const evenements = [
    ...LANCEMENT,
    principal('PostToolUse', 'TaskStop', 'toolu_stop', ARRET, {
      tool_input: { task_id: 'b0000046' }, tool_response: stopTask('b0000046', 'local_bash'),
    }),
  ];
  // Act
  rejouer(evenements);
  // Assert
  const n = state.nodes.get(`a:${ARRIERE_PLAN}`)!;
  expect(n.status).toBe('running');
  expect(n.endTime).toBeNull();
});

test('TaskStop d\'un sous-agent déjà fini : sa fin ne bouge pas', () => {
  // Arrange
  const finReelle = '2026-10-30T10:46:16.000Z';
  const evenements = [
    ...LANCEMENT,
    { hook_event_name: 'SubagentStop', session_id: SID, agent_id: ARRIERE_PLAN, _ts: finReelle },
    ...ARRET_PAR_TASKSTOP,
  ];
  // Act
  rejouer(evenements);
  // Assert
  const n = state.nodes.get(`a:${ARRIERE_PLAN}`)!;
  expect(n.status).toBe('done');
  expect(n.endTime).toBe(finReelle);
});

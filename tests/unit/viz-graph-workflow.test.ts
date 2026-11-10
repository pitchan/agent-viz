// Un workflow lancé en arrière-plan fait travailler ses sous-agents après la fin du tour qui l'a
// lancé : le Stop liste le workflow « running », pas ses sous-agents. Aucun événement ne relie un
// sous-agent à son workflow. Un sous-agent finit à son StructuredOutput, ou au plus tard quand
// plus aucun workflow de la session ne tourne. Séquence au format des sessions réelles.

import { beforeEach, expect, test } from 'vitest';
import { state, vis } from '../../src/web/viz-state.ts';
import { processEvent, type HookEvent } from '../../src/web/viz-graph.ts';
import { resetGraph } from '../helpers/viz-graph-events.ts';

beforeEach(resetGraph);

const rejouer = (evts: HookEvent[]) => { for (const e of evts) processEvent(e); };

const SID = '00000000-0000-4000-8000-000000000048';
const WF_A = 'wa0000048';
const WF_B = 'wb0000048';
const STRUCTURE = 'a000000000000a048';
const SANS_SCHEMA = 'a000000000000b048';
const AUTRE_WORKFLOW = 'a000000000000c048';
const FIN_DU_TOUR = '2026-11-04T22:00:37.456Z';
const SORTIE = '2026-11-04T22:25:10.000Z';
const NOTIF_A = '2026-11-04T22:30:00.000Z';
const NOTIF_B = '2026-11-04T22:40:00.000Z';

const outil = (aid: string, hook: string, tool: string, tid: string, ts: string): HookEvent => ({
  hook_event_name: hook, session_id: SID, agent_id: aid, agent_type: 'workflow-subagent',
  tool_name: tool, tool_use_id: tid, tool_input: {}, _ts: ts,
});

const stop = (ts: string, workflows: string[]): HookEvent => ({
  hook_event_name: 'Stop', session_id: SID, _ts: ts,
  background_tasks: workflows.map(id => ({ id, type: 'workflow', status: 'running', name: 'verif' })),
} as HookEvent);

const notification = (taskId: string, ts: string): HookEvent => ({
  hook_event_name: 'UserPromptSubmit', session_id: SID, _ts: ts,
  prompt: `<task-notification>\n<task-id>${taskId}</task-id>\n<tool-use-id>toolu_lanceur</tool-use-id>\n<status>completed</status>\n<summary>Workflow "verif" completed</summary>\n</task-notification>`,
} as HookEvent);

const LANCEMENT: HookEvent[] = [
  { hook_event_name: 'SessionStart', session_id: SID, _ts: '2026-11-04T22:00:00.000Z' },
  outil(STRUCTURE, 'PreToolUse', 'Read', 'toolu_a1', '2026-11-04T22:00:30.000Z'),
  outil(STRUCTURE, 'PostToolUse', 'Read', 'toolu_a1', '2026-11-04T22:00:31.000Z'),
  outil(SANS_SCHEMA, 'PreToolUse', 'Bash', 'toolu_b1', '2026-11-04T22:00:32.000Z'),
  stop(FIN_DU_TOUR, [WF_A]),
];

const SUITE: HookEvent[] = [
  outil(SANS_SCHEMA, 'PostToolUse', 'Bash', 'toolu_b1', '2026-11-04T22:01:00.000Z'),
  outil(STRUCTURE, 'PreToolUse', 'Bash', 'toolu_a2', '2026-11-04T22:20:00.000Z'),
  outil(STRUCTURE, 'PostToolUse', 'Bash', 'toolu_a2', '2026-11-04T22:24:00.000Z'),
  outil(STRUCTURE, 'PreToolUse', 'StructuredOutput', 'toolu_a3', '2026-11-04T22:25:09.000Z'),
  outil(STRUCTURE, 'PostToolUse', 'StructuredOutput', 'toolu_a3', SORTIE),
  outil(SANS_SCHEMA, 'PreToolUse', 'Bash', 'toolu_b2', '2026-11-04T22:28:00.000Z'),
  outil(SANS_SCHEMA, 'PostToolUse', 'Bash', 'toolu_b2', '2026-11-04T22:29:00.000Z'),
];

test('fin du tour : un sous-agent de workflow reste en cours tant que le Stop liste un workflow en cours', () => {
  // Arrange
  const evenements = LANCEMENT;
  // Act
  rejouer(evenements);
  // Assert
  for (const aid of [STRUCTURE, SANS_SCHEMA]) {
    const n = state.nodes.get(`a:${aid}`)!;
    expect(n.status).toBe('running');
    expect(n.endTime).toBeNull();
    expect(vis.runningNodes.has(n.id)).toBe(true);
  }
  expect(state.nodes.get('t:toolu_b1')!.status).toBe('running');
});

test('fin du tour sans workflow en cours : le sous-agent de workflow se ferme à la fin du tour', () => {
  // Arrange
  const evenements = [...LANCEMENT.slice(0, -1), stop(FIN_DU_TOUR, [])];
  // Act
  rejouer(evenements);
  // Assert
  expect(state.nodes.get(`a:${STRUCTURE}`)!.endTime).toBe(FIN_DU_TOUR);
});

test('le StructuredOutput rendu ferme le sous-agent de workflow à son heure', () => {
  // Arrange
  const evenements = [...LANCEMENT, ...SUITE];
  // Act
  rejouer(evenements);
  // Assert
  const n = state.nodes.get(`a:${STRUCTURE}`)!;
  expect(n.status).toBe('done');
  expect(n.endTime).toBe(SORTIE);
  expect(vis.runningNodes.has(n.id)).toBe(false);
  expect(state.nodes.get(`a:${SANS_SCHEMA}`)!.status).toBe('running');
});

test('la notification de fin du workflow ferme le sous-agent resté ouvert à l\'heure de la notification', () => {
  // Arrange
  const evenements = [...LANCEMENT, ...SUITE, notification(WF_A, NOTIF_A)];
  // Act
  rejouer(evenements);
  // Assert
  const n = state.nodes.get(`a:${SANS_SCHEMA}`)!;
  expect(n.status).toBe('done');
  expect(n.endTime).toBe(NOTIF_A);
  expect(vis.runningNodes.has(n.id)).toBe(false);
  expect(state.nodes.get(`a:${STRUCTURE}`)!.endTime).toBe(SORTIE);
});

const DEUX_WORKFLOWS: HookEvent[] = [
  ...LANCEMENT.slice(0, -1),
  outil(AUTRE_WORKFLOW, 'PreToolUse', 'Grep', 'toolu_c1', '2026-11-04T22:00:35.000Z'),
  stop(FIN_DU_TOUR, [WF_A, WF_B]),
  ...SUITE,
  notification(WF_A, NOTIF_A),
];

test('deux workflows en cours : la fin du premier ne ferme aucun sous-agent de workflow', () => {
  // Arrange
  const evenements = DEUX_WORKFLOWS;
  // Act
  rejouer(evenements);
  // Assert
  for (const aid of [SANS_SCHEMA, AUTRE_WORKFLOW]) expect(state.nodes.get(`a:${aid}`)!.status).toBe('running');
});

test('deux workflows en cours : la fin du second ferme les sous-agents restés ouverts', () => {
  // Arrange
  const evenements = [...DEUX_WORKFLOWS, notification(WF_B, NOTIF_B)];
  // Act
  rejouer(evenements);
  // Assert
  for (const aid of [SANS_SCHEMA, AUTRE_WORKFLOW]) expect(state.nodes.get(`a:${aid}`)!.endTime).toBe(NOTIF_B);
});

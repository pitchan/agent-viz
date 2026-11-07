// Un sous-agent Claude Code lancé en arrière-plan travaille encore quand le tour qui l'a lancé
// finit : le Stop le liste « running » dans background_tasks. Sa fin arrive plus tard, dans un
// message du fil principal : son compte rendu, ou la notification de fin de sa tâche. Séquence
// rejouée depuis une session réelle, identifiants anonymisés, horaires d'origine.

import { beforeEach, expect, test } from 'vitest';
import { state, vis } from '../../src/web/viz-state.ts';
import { calcDuration, processEvent, type HookEvent } from '../../src/web/viz-graph.ts';
import { resetGraph } from '../helpers/viz-graph-events.ts';

beforeEach(resetGraph);

const rejouer = (evts: HookEvent[]) => { for (const e of evts) processEvent(e); };

const SID = '00000000-0000-4000-8000-000000000047';
const RAPPORTEUR = 'a000000000000a047';
const INTERROMPU = 'a000000000000b047';
const AU_PREMIER_PLAN = 'a000000000000c047';
const FIN_DU_TOUR = '2026-10-30T10:39:10.541Z';
const COMPTE_RENDU = '2026-10-30T10:43:20.288Z';
const NOTIFICATION = '2026-10-30T10:46:17.241Z';

const outil = (aid: string, hook: string, tool: string, tid: string, ts: string): HookEvent => ({
  hook_event_name: hook, session_id: SID, agent_id: aid, agent_type: 'general-purpose',
  tool_name: tool, tool_use_id: tid, tool_input: {}, _ts: ts,
});

const message = (prompt: string, ts: string): HookEvent => ({
  hook_event_name: 'UserPromptSubmit', session_id: SID, prompt, _ts: ts,
} as HookEvent);

const tache = (id: string, type: string) => ({ id, type, status: 'running', description: 'Corriger' });

const LANCEMENT: HookEvent[] = [
  { hook_event_name: 'SessionStart', session_id: SID, _ts: '2026-10-30T10:38:40.000Z' },
  outil(INTERROMPU, 'PreToolUse', 'Read', 'toolu_b1', '2026-10-30T10:38:47.549Z'),
  outil(INTERROMPU, 'PostToolUse', 'Read', 'toolu_b1', '2026-10-30T10:38:48.147Z'),
  outil(RAPPORTEUR, 'PreToolUse', 'Bash', 'toolu_a1', '2026-10-30T10:38:50.397Z'),
  outil(RAPPORTEUR, 'PostToolUse', 'Bash', 'toolu_a1', '2026-10-30T10:38:51.000Z'),
  outil(AU_PREMIER_PLAN, 'PreToolUse', 'Grep', 'toolu_c1', '2026-10-30T10:38:52.000Z'),
  outil(AU_PREMIER_PLAN, 'PostToolUse', 'Grep', 'toolu_c1', '2026-10-30T10:38:53.000Z'),
  outil(INTERROMPU, 'PreToolUse', 'PowerShell', 'toolu_b2', '2026-10-30T10:39:09.082Z'),
];

const STOP: HookEvent = {
  hook_event_name: 'Stop', session_id: SID, _ts: FIN_DU_TOUR,
  background_tasks: [tache(RAPPORTEUR, 'subagent'), tache(INTERROMPU, 'subagent'), tache('b0000047', 'shell')],
} as HookEvent;

const SUITE: HookEvent[] = [
  outil(INTERROMPU, 'PostToolUse', 'PowerShell', 'toolu_b2', '2026-10-30T10:39:12.000Z'),
  outil(RAPPORTEUR, 'PreToolUse', 'SubagentHandback', 'toolu_a2', '2026-10-30T10:43:14.200Z'),
  outil(RAPPORTEUR, 'PostToolUse', 'SubagentHandback', 'toolu_a2', '2026-10-30T10:43:14.346Z'),
  message(`<agent-message from="${RAPPORTEUR}">\n[Subagent hand-back] The text below is the final report of a subagent this session delegated to.\n\nFait.`, COMPTE_RENDU),
  outil(INTERROMPU, 'PreToolUse', 'Bash', 'toolu_b3', '2026-10-30T10:45:53.000Z'),
  outil(INTERROMPU, 'PostToolUse', 'Bash', 'toolu_b3', '2026-10-30T10:45:54.021Z'),
  message(`<task-notification>\n<task-id>${INTERROMPU}</task-id>\n<tool-use-id>toolu_lanceur</tool-use-id>\n<output-file>sortie.output</output-file>\n<status>killed</status>\n<summary>Agent "Corriger" was stopped</summary>\n</task-notification>`, NOTIFICATION),
];

test('fin du tour : un sous-agent que le Stop dit encore en cours reste en cours, avec son outil en vol', () => {
  // Arrange
  const evenements = [...LANCEMENT, STOP];
  // Act
  rejouer(evenements);
  // Assert
  for (const aid of [RAPPORTEUR, INTERROMPU]) {
    const n = state.nodes.get(`a:${aid}`)!;
    expect(n.status).toBe('running');
    expect(n.endTime).toBeNull();
    expect(vis.runningNodes.has(n.id)).toBe(true);
  }
  expect(state.nodes.get('t:toolu_b2')!.status).toBe('running');
  expect(state.nodes.get(`s:${SID}`)!.status).toBe('done');
});

test('fin du tour : un sous-agent que le Stop ne liste pas se ferme à la fin du tour', () => {
  // Arrange
  const evenements = [...LANCEMENT, STOP];
  // Act
  rejouer(evenements);
  // Assert
  const n = state.nodes.get(`a:${AU_PREMIER_PLAN}`)!;
  expect(n.status).toBe('done');
  expect(n.endTime).toBe(FIN_DU_TOUR);
});

test('le compte rendu de fin du sous-agent le ferme à l\'heure du compte rendu', () => {
  // Arrange
  const evenements = [...LANCEMENT, STOP, ...SUITE];
  // Act
  rejouer(evenements);
  // Assert
  const n = state.nodes.get(`a:${RAPPORTEUR}`)!;
  expect(n.status).toBe('done');
  expect(n.endTime).toBe(COMPTE_RENDU);
  expect(n.duration).toBe(calcDuration('2026-10-30T10:38:50.397Z', COMPTE_RENDU));
  expect(vis.runningNodes.has(n.id)).toBe(false);
});

test('la notification de fin de tâche ferme le sous-agent à l\'heure de la notification', () => {
  // Arrange
  const evenements = [...LANCEMENT, STOP, ...SUITE];
  // Act
  rejouer(evenements);
  // Assert
  const n = state.nodes.get(`a:${INTERROMPU}`)!;
  expect(n.status).toBe('done');
  expect(n.endTime).toBe(NOTIFICATION);
  expect(vis.runningNodes.has(n.id)).toBe(false);
});

test('la fin de session ferme un sous-agent resté ouvert après la fin du tour', () => {
  // Arrange
  const finDeSession = '2026-10-30T10:41:00.000Z';
  const evenements = [
    ...LANCEMENT, STOP,
    { hook_event_name: 'SessionEnd', session_id: SID, reason: 'other', _ts: finDeSession } as HookEvent,
  ];
  // Act
  rejouer(evenements);
  // Assert
  for (const aid of [RAPPORTEUR, INTERROMPU]) {
    const n = state.nodes.get(`a:${aid}`)!;
    expect(n.status).toBe('done');
    expect(n.endTime).toBe(finDeSession);
  }
  expect(state.nodes.get('t:toolu_b2')!.status).toBe('done');
});

test('un compte rendu arrivé après la fin de session ne déplace pas la fin du sous-agent', () => {
  // Arrange
  const finDeSession = '2026-10-30T10:41:00.000Z';
  const evenements = [
    ...LANCEMENT, STOP,
    { hook_event_name: 'SessionEnd', session_id: SID, reason: 'other', _ts: finDeSession } as HookEvent,
    ...SUITE,
  ];
  // Act
  rejouer(evenements);
  // Assert
  expect(state.nodes.get(`a:${RAPPORTEUR}`)!.endTime).toBe(finDeSession);
});

// Un sous-agent Claude Code qui a rendu son compte rendu est fermé ; l'agent principal peut le
// relancer avec SendMessage. Deux séquences rejouées depuis des sessions réelles, identifiants
// anonymisés, horaires d'origine : relance en arrière-plan, puis relance au premier plan.

import { beforeEach, expect, test } from 'vitest';
import { state, vis } from '../../src/web/viz-state.ts';
import { processEvent, type HookEvent } from '../../src/web/viz-graph.ts';
import { resetGraph } from '../helpers/viz-graph-events.ts';

beforeEach(resetGraph);

const rejouer = (evts: HookEvent[]) => { for (const e of evts) processEvent(e); };

const SID = '00000000-0000-4000-8000-000000000052';
const AID = 'a000000000000a052';

const outil = (hook: string, tool: string, tid: string, ts: string): HookEvent => ({
  hook_event_name: hook, session_id: SID, agent_id: AID, agent_type: 'general-purpose',
  tool_name: tool, tool_use_id: tid, tool_input: {}, _ts: ts,
});

const compteRendu = (ts: string): HookEvent => ({
  hook_event_name: 'UserPromptSubmit', session_id: SID, _ts: ts,
  prompt: `<agent-message from="${AID}">\n[Subagent hand-back] The text below is the final report of a subagent this session delegated to.\n\nFait.`,
} as HookEvent);

const ENVOI = { to: AID, recipient: AID, recipient_kind: 'agent', type: 'message', message: 'Complète.' };

const envoi = (ts: string): HookEvent => ({
  hook_event_name: 'PreToolUse', session_id: SID, tool_name: 'SendMessage',
  tool_use_id: 'toolu_envoi', tool_input: ENVOI, _ts: ts,
} as HookEvent);

const retourEnvoi = (tool_response: object, ts: string): HookEvent => ({
  hook_event_name: 'PostToolUse', session_id: SID, tool_name: 'SendMessage',
  tool_use_id: 'toolu_envoi', tool_input: ENVOI, tool_response, _ts: ts,
} as HookEvent);

const PREMIERE_VIE: HookEvent[] = [
  { hook_event_name: 'SessionStart', session_id: SID, _ts: '2026-11-05T14:26:00.000Z' },
  outil('PreToolUse', 'WebFetch', 'toolu_a1', '2026-11-05T14:26:26.406Z'),
  outil('PostToolUse', 'WebFetch', 'toolu_a1', '2026-11-05T14:26:34.273Z'),
  outil('PreToolUse', 'SubagentHandback', 'toolu_a2', '2026-11-05T14:27:22.666Z'),
  outil('PostToolUse', 'SubagentHandback', 'toolu_a2', '2026-11-05T14:27:22.821Z'),
  compteRendu('2026-11-05T14:27:22.829Z'),
];

const RELANCE_EN_ARRIERE_PLAN: HookEvent[] = [
  envoi('2026-11-05T14:27:28.156Z'),
  retourEnvoi({
    success: true, message: `Resuming agent ${AID.slice(0, 7)}`, resumedAgentId: AID, revivedAgentId: AID,
  }, '2026-11-05T14:27:28.280Z'),
  outil('PreToolUse', 'WebFetch', 'toolu_a3', '2026-11-05T14:27:29.696Z'),
  { hook_event_name: 'Stop', session_id: SID, _ts: '2026-11-05T14:27:31.251Z',
    background_tasks: [{ id: AID, type: 'subagent', status: 'running' }] } as HookEvent,
  outil('PostToolUse', 'WebFetch', 'toolu_a3', '2026-11-05T14:27:33.779Z'),
];

const FIN_DE_RELANCE = '2026-11-05T14:27:49.057Z';

test('relance en arrière-plan : le sous-agent fermé repasse en cours dès le SendMessage', () => {
  // Arrange
  const evenements = [...PREMIERE_VIE, RELANCE_EN_ARRIERE_PLAN[0]!];
  // Act
  rejouer(evenements);
  // Assert
  const n = state.nodes.get(`a:${AID}`)!;
  expect(n.status).toBe('running');
  expect(n.endTime).toBeNull();
  expect(vis.runningNodes.has(n.id)).toBe(true);
});

test('relance en arrière-plan : le sous-agent reste en cours pendant qu\'il travaille, fin de tour comprise', () => {
  // Arrange
  const evenements = [...PREMIERE_VIE, ...RELANCE_EN_ARRIERE_PLAN];
  // Act
  rejouer(evenements);
  // Assert
  const n = state.nodes.get(`a:${AID}`)!;
  expect(n.status).toBe('running');
  expect(vis.runningNodes.has(n.id)).toBe(true);
});

test('relance en arrière-plan : son nouveau compte rendu le referme à l\'heure du compte rendu', () => {
  // Arrange
  const evenements = [...PREMIERE_VIE, ...RELANCE_EN_ARRIERE_PLAN, compteRendu(FIN_DE_RELANCE)];
  // Act
  rejouer(evenements);
  // Assert
  const n = state.nodes.get(`a:${AID}`)!;
  expect(n.status).toBe('done');
  expect(n.endTime).toBe(FIN_DE_RELANCE);
  expect(vis.runningNodes.has(n.id)).toBe(false);
});

const RELANCE_AU_PREMIER_PLAN: HookEvent[] = [
  envoi('2026-11-08T20:15:13.991Z'),
  outil('PreToolUse', 'WebFetch', 'toolu_b1', '2026-11-08T20:15:23.000Z'),
  outil('PostToolUse', 'WebFetch', 'toolu_b1', '2026-11-08T20:15:27.982Z'),
  outil('PreToolUse', 'SubagentHandback', 'toolu_b2', '2026-11-08T20:15:36.707Z'),
  outil('PostToolUse', 'SubagentHandback', 'toolu_b2', '2026-11-08T20:15:36.823Z'),
];

const RETOUR_AU_PREMIER_PLAN = '2026-11-08T20:15:36.930Z';

const RETOUR_AVEC_COMPTE_RENDU = retourEnvoi({
  success: true, message: 'Resumed agent. Its final report is not in this message.',
  inlineHandback: { displayName: AID.slice(0, 7), content: [] },
}, RETOUR_AU_PREMIER_PLAN);

test('relance au premier plan : le sous-agent est en cours tant que le SendMessage n\'a pas rendu la main', () => {
  // Arrange
  const evenements = [...PREMIERE_VIE, ...RELANCE_AU_PREMIER_PLAN];
  // Act
  rejouer(evenements);
  // Assert
  const n = state.nodes.get(`a:${AID}`)!;
  expect(n.status).toBe('running');
  expect(vis.runningNodes.has(n.id)).toBe(true);
});

test('relance au premier plan : le retour du SendMessage qui porte son compte rendu le referme', () => {
  // Arrange
  const evenements = [...PREMIERE_VIE, ...RELANCE_AU_PREMIER_PLAN, RETOUR_AVEC_COMPTE_RENDU,
    compteRendu('2026-11-08T20:16:29.620Z')];
  // Act
  rejouer(evenements);
  // Assert
  const n = state.nodes.get(`a:${AID}`)!;
  expect(n.status).toBe('done');
  expect(n.endTime).toBe(RETOUR_AU_PREMIER_PLAN);
  expect(vis.runningNodes.has(n.id)).toBe(false);
});

test('un SendMessage adressé à une session ne touche à aucun sous-agent', () => {
  // Arrange
  const versSession: HookEvent = {
    hook_event_name: 'PreToolUse', session_id: SID, tool_name: 'SendMessage', tool_use_id: 'toolu_s',
    tool_input: { to: AID, recipient: AID, recipient_kind: 'session', type: 'message' },
    _ts: '2026-11-05T14:27:28.156Z',
  } as HookEvent;
  // Act
  rejouer([...PREMIERE_VIE, versSession]);
  // Assert
  expect(state.nodes.get(`a:${AID}`)!.status).toBe('done');
});

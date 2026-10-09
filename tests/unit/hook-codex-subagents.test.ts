// Le nom d'un sous-agent Codex et l'heure de sa fin, lus dans les transcripts au passage d'un hook.
import { expect, test } from 'vitest';
import { agentIdentity, subagentStops } from '../../src/server/hook-codex-subagents.ts';

const PARENT = '01a12200-6169-7122-8500-0ebbdde6d416';
const ENFANT = '01a12200-8ec7-7b63-bded-3d39504cb192';
const lignes = (...objets: unknown[]) => objets.map(o => JSON.stringify(o)).join('\n') + '\n';

// Forme relevée sur la première ligne d'un transcript réel de Codex 0.162.
function enTete(extra: Record<string, unknown>) {
  return { timestamp: '2026-10-09T18:50:24.404Z', type: 'session_meta', payload: { id: ENFANT, cli_version: '0.162.0-alpha.2', ...extra } };
}

// Forme relevée dans le transcript réel du fil qui a lancé le sous-agent.
function activite(kind: 'started' | 'interacted' | 'completed', id: string, timestamp: string) {
  return {
    timestamp, type: 'event_msg',
    payload: { type: 'item_completed', thread_id: PARENT, item: { type: 'SubAgentActivity', id, kind, agent_thread_id: ENFANT, agent_path: '/root/child' } },
  };
}

const FIN = activite('completed', 'subagent-completed-01a12200-8f14', '2026-10-09T18:50:33.808Z');
const attente = { session_id: PARENT, hook_event_name: 'PostToolUse', tool_name: 'collaborationwait_agent', transcript_path: 'C:/parent.jsonl' };

test('un sous-agent porte le dernier segment de son chemin pour nom, et son surnom', () => {
  // Arrange
  const tete = lignes(enTete({ parent_thread_id: PARENT, agent_path: '/root/child', agent_nickname: 'Avicenna' }), { type: 'turn_context' });
  // Act
  const identite = agentIdentity(tete);
  // Assert
  expect(identite).toEqual({ agent_name: 'child', agent_nickname: 'Avicenna' });
});

test('un sous-agent lancé par un sous-agent garde le dernier segment seulement', () => {
  // Arrange
  const tete = lignes(enTete({ agent_path: '/root/audit/relecture_2', agent_nickname: 'Confucius' }));
  // Act
  const identite = agentIdentity(tete);
  // Assert
  expect(identite?.agent_name).toBe('relecture_2');
});

test('un fil principal, sans chemin d\'agent, n\'a pas de nom', () => {
  // Arrange
  const tete = lignes(enTete({ source: 'exec' }));
  // Act
  const identite = agentIdentity(tete);
  // Assert
  expect(identite).toBe(null);
});

test('un transcript vide ne donne pas de nom', () => {
  expect(agentIdentity('')).toBe(null);
});

test('la fin d\'un sous-agent écrite dans le transcript donne un arrêt qui porte ses heures réelles de lancement et de fin', () => {
  // Arrange
  const transcript = lignes(activite('started', 'call_rCZv9Am8', '2026-10-09T18:50:24.404Z'), FIN);
  // Act
  const arrets = subagentStops(attente, '', transcript);
  // Assert
  expect(arrets).toEqual([{
    hook_event_name: 'SubagentStop',
    session_id: PARENT,
    agent_id: ENFANT,
    activity_id: 'subagent-completed-01a12200-8f14',
    started_at: '2026-10-09T18:50:24.404Z',
    ended_at: '2026-10-09T18:50:33.808Z',
    transcript_path: 'C:/parent.jsonl',
  }]);
});

test('une fin dont le lancement est sorti de la fenêtre de lecture ne porte pas d\'heure de lancement', () => {
  // Arrange
  const transcript = lignes(FIN);
  // Act
  const arrets = subagentStops(attente, '', transcript);
  // Assert
  expect(arrets[0]).toMatchObject({ agent_id: ENFANT, ended_at: '2026-10-09T18:50:33.808Z' });
  expect(arrets[0]?.started_at).toBeUndefined();
});

test('un sous-agent lancé mais pas fini ne donne aucun arrêt', () => {
  // Arrange
  const transcript = lignes(activite('started', 'call_rCZv9Am8', '2026-10-09T18:50:24.404Z'));
  // Act
  const arrets = subagentStops(attente, '', transcript);
  // Assert
  expect(arrets).toEqual([]);
});

test('un arrêt déjà écrit n\'est pas écrit une seconde fois', () => {
  // Arrange
  const dejaEcrits = lignes({ hook_event_name: 'SubagentStop', agent_id: ENFANT, activity_id: 'subagent-completed-01a12200-8f14' });
  // Act
  const arrets = subagentStops(attente, dejaEcrits, lignes(FIN));
  // Assert
  expect(arrets).toEqual([]);
});

// Suite relevée sur une session réelle de Codex 0.162 : lancé, fini, relancé par un message, fini.
const LANCE = activite('started', 'call_85b1cc0c', '2026-10-09T19:13:35.540Z');
const FINI = activite('completed', 'subagent-completed-01a12215-c934', '2026-10-09T19:13:41.454Z');
const RELANCE = activite('interacted', 'call_755c8718', '2026-10-09T19:13:53.803Z');
const REFINI = activite('completed', 'subagent-completed-01a12216-108b', '2026-10-09T19:14:00.437Z');

test('un sous-agent relancé puis fini une seconde fois donne un second arrêt, compté depuis sa relance', () => {
  // Arrange
  const dejaEcrits = lignes({ hook_event_name: 'SubagentStop', agent_id: ENFANT, activity_id: 'subagent-completed-01a12215-c934' });
  // Act
  const arrets = subagentStops(attente, dejaEcrits, lignes(LANCE, FINI, RELANCE, REFINI));
  // Assert
  expect(arrets.map(a => [a.started_at, a.ended_at])).toEqual([['2026-10-09T19:13:53.803Z', '2026-10-09T19:14:00.437Z']]);
});

test('un message reçu par un sous-agent en plein travail ne déplace pas le début de son passage', () => {
  // Arrange
  const message = activite('interacted', 'call_message', '2026-10-09T19:13:38.000Z');
  // Act
  const arrets = subagentStops(attente, '', lignes(LANCE, message, FINI));
  // Assert
  expect(arrets[0]?.started_at).toBe('2026-10-09T19:13:35.540Z');
});

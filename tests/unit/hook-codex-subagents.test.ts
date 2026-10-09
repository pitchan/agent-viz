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
function activite(kind: 'started' | 'completed', id: string, timestamp: string) {
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

test('un transcript illisible ou vide ne donne pas de nom', () => {
  expect(agentIdentity('')).toBe(null);
});

test('la fin d\'un sous-agent écrite dans le transcript donne un arrêt daté de son heure réelle', () => {
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
    ended_at: '2026-10-09T18:50:33.808Z',
    transcript_path: 'C:/parent.jsonl',
  }]);
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

test('un sous-agent relancé puis fini une seconde fois donne un second arrêt', () => {
  // Arrange
  const dejaEcrits = lignes({ hook_event_name: 'SubagentStop', agent_id: ENFANT, activity_id: 'subagent-completed-01a12200-8f14' });
  const seconde = activite('completed', 'subagent-completed-01a12200-9aaa', '2026-10-09T18:52:10.000Z');
  // Act
  const arrets = subagentStops(attente, dejaEcrits, lignes(FIN, seconde));
  // Assert
  expect(arrets.map(a => a.ended_at)).toEqual(['2026-10-09T18:52:10.000Z']);
});

// Le début d'un sous-agent Codex, lu dans le transcript du fil qui l'a lancé dès son lancement.
// Formes de lignes relevées sur une session réelle de Codex 0.163 ; identifiants et surnoms neutralisés.
import { expect, test } from 'vitest';
import { subagentStarts } from '../../src/server/hook-codex-subagents.ts';

const SESSION = '01a18c32-6f35-78b0-a09f-000000000001';
const ENFANT = '01a18c32-9406-7bf2-b730-000000000002';
const PETIT_FILS = '01a18c32-aa83-7142-90bd-000000000003';
const lignes = (...objets: unknown[]) => objets.map(o => JSON.stringify(o)).join('\n') + '\n';

function lancement(fil: string, enfant: string, chemin: string, id: string, timestamp: string) {
  return {
    timestamp, ordinal: 15, type: 'event_msg',
    payload: {
      type: 'item_completed', thread_id: fil,
      item: { type: 'SubAgentActivity', model: 'gpt-6.1-sol', reasoning_effort: 'low', id, kind: 'started', agent_thread_id: enfant, agent_path: chemin },
    },
  };
}

function enTete(fil: string, parent: string, chemin: string, surnom: string) {
  return lignes({
    timestamp: '2026-10-30T09:44:47.368Z', ordinal: 0, type: 'session_meta',
    payload: { session_id: SESSION, id: fil, parent_thread_id: parent, thread_source: 'subagent', agent_nickname: surnom, agent_path: chemin },
  });
}

const LANCE_A = lancement(SESSION, ENFANT, '/root/a', 'call_a41259d7', '2026-10-30T09:44:47.430Z');
const finDuLancement = { session_id: SESSION, hook_event_name: 'PostToolUse', tool_name: 'collaborationspawn_agent', transcript_path: 'C:/sessions/parent.jsonl' };
const transcriptsEnfants: Record<string, { path: string; head: string }> = {
  [ENFANT]: { path: 'C:/sessions/enfant.jsonl', head: enTete(ENFANT, SESSION, '/root/a', 'Faraday') },
  [PETIT_FILS]: { path: 'C:/sessions/petit-fils.jsonl', head: enTete(PETIT_FILS, ENFANT, '/root/a/relecture', 'Hegel') },
};
const trouver = (fil: string) => transcriptsEnfants[fil] ?? null;

test('le lancement d un sous-agent donne un début qui porte son nom, son surnom, son heure réelle et son transcript', () => {
  // Arrange
  const transcript = lignes(LANCE_A);
  // Act
  const debuts = subagentStarts(finDuLancement, '', transcript, trouver);
  // Assert
  expect(debuts).toEqual([{
    hook_event_name: 'SubagentStart',
    session_id: SESSION,
    agent_id: ENFANT,
    activity_id: 'call_a41259d7',
    started_at: '2026-10-30T09:44:47.430Z',
    agent_name: 'a',
    agent_nickname: 'Faraday',
    transcript_path: 'C:/sessions/enfant.jsonl',
  }]);
});

test('un début déjà écrit n est pas écrit une seconde fois', () => {
  // Arrange
  const dejaEcrits = lignes({ hook_event_name: 'SubagentStart', agent_id: ENFANT, activity_id: 'call_a41259d7' });
  // Act
  const debuts = subagentStarts(finDuLancement, dejaEcrits, lignes(LANCE_A), trouver);
  // Assert
  expect(debuts).toEqual([]);
});

test('un sous-agent lancé par un sous-agent porte le fil de son lanceur', () => {
  // Arrange
  const transcriptEnfant = lignes(lancement(ENFANT, PETIT_FILS, '/root/a/relecture', 'call_95e4b469', '2026-10-30T09:44:53.141Z'));
  const finDuLancementParEnfant = { ...finDuLancement, agent_id: ENFANT, transcript_path: 'C:/sessions/enfant.jsonl' };
  // Act
  const debuts = subagentStarts(finDuLancementParEnfant, '', transcriptEnfant, trouver);
  // Assert
  expect(debuts[0]).toMatchObject({ agent_id: PETIT_FILS, agent_name: 'relecture', agent_nickname: 'Hegel', parent_agent_id: ENFANT });
});

test('un sous-agent lancé par le fil principal ne porte pas de lanceur', () => {
  // Arrange
  const transcript = lignes(LANCE_A);
  // Act
  const debuts = subagentStarts(finDuLancement, '', transcript, trouver);
  // Assert
  expect(debuts[0]?.parent_agent_id).toBeUndefined();
});

test('un sous-agent dont le transcript reste introuvable démarre quand même, sous son nom', () => {
  // Arrange
  const transcript = lignes(LANCE_A);
  // Act
  const debuts = subagentStarts(finDuLancement, '', transcript, () => null);
  // Assert
  expect(debuts).toEqual([{
    hook_event_name: 'SubagentStart', session_id: SESSION, agent_id: ENFANT,
    activity_id: 'call_a41259d7', started_at: '2026-10-30T09:44:47.430Z', agent_name: 'a',
  }]);
});

test('la relance d un sous-agent fini n est pas un début', () => {
  // Arrange
  const relance = { ...LANCE_A, payload: { ...LANCE_A.payload, item: { ...LANCE_A.payload.item, kind: 'interacted', id: 'call_755c8718' } } };
  // Act
  const debuts = subagentStarts(finDuLancement, '', lignes(relance), trouver);
  // Assert
  expect(debuts).toEqual([]);
});

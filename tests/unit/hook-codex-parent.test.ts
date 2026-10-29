// Le fil qui a lancé un sous-agent Codex, lu dans l'en-tête de son transcript.
import { expect, test } from 'vitest';
import { parentAgent } from '../../src/server/hook-codex-subagents.ts';

const SESSION = '01a00000-0000-7000-8000-000000000009';
const ENFANT = '01a00000-0000-7000-8000-00000000e001';
const PETIT_FILS = '01a00000-0000-7000-8000-00000000f002';

// Forme relevée sur la première ligne du transcript réel d'un sous-agent de Codex 0.163.
function tete(id: string, parent: string) {
  const meta = { timestamp: '2026-10-29T22:39:03.738Z', type: 'session_meta',
    payload: { session_id: SESSION, id, parent_thread_id: parent, agent_path: '/root/lecture_deleguee/lecture_cible', agent_nickname: 'Lovelace' } };
  return JSON.stringify(meta) + '\n' + JSON.stringify({ type: 'turn_context' }) + '\n';
}

test('un sous-agent lancé par un sous-agent nomme ce sous-agent pour parent', () => {
  // Arrange
  const entete = tete(PETIT_FILS, ENFANT);
  // Act
  const parent = parentAgent(entete);
  // Assert
  expect(parent).toEqual({ parent_agent_id: ENFANT });
});

test('un sous-agent lancé par le fil principal n\'a pas d\'agent parent', () => {
  // Arrange
  const entete = tete(ENFANT, SESSION);
  // Act
  const parent = parentAgent(entete);
  // Assert
  expect(parent).toBe(null);
});

test('un transcript vide ne donne pas de parent', () => {
  expect(parentAgent('')).toBe(null);
});

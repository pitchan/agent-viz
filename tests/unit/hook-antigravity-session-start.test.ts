// Le début d'une conversation Antigravity, lu dans son transcript à la fin d'un appel au modèle.
import { expect, test } from 'vitest';
import { sessionStart } from '../../src/server/hook-antigravity-session-start.ts';

const CONV = '52ecab21';
const lignes = (...objets: unknown[]) => objets.map(o => JSON.stringify(o)).join('\n') + '\n';

// Ce que la normalisation rend pour un PostInvocation d'agy.
const base = {
  hook_event_name: 'PostInvocation', _native_event: 'PostInvocation',
  session_id: CONV, cwd: 'C:/projet', transcript_path: 'C:/t.jsonl',
};

// Forme relevée sur un transcript réel d'agy 1.2.15.
function question(overrides: Record<string, unknown> = {}) {
  return {
    step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', status: 'DONE',
    created_at: '2026-10-08T20:37:26Z', content: '<USER_REQUEST>\nbonjour\n</USER_REQUEST>',
    ...overrides,
  };
}

test('la première question du transcript donne un début de session daté de son heure', () => {
  // Arrange
  const transcript = lignes(question(), { step_index: 1, type: 'PLANNER_RESPONSE', created_at: '2026-10-08T20:37:31Z' });
  // Act
  const evenements = sessionStart(base, '', transcript);
  // Assert
  expect(evenements).toEqual([{
    hook_event_name: 'SessionStart',
    _native_event: 'PostInvocation',
    session_id: CONV,
    cwd: 'C:/projet',
    transcript_path: 'C:/t.jsonl',
    started_at: '2026-10-08T20:37:26Z',
  }]);
});

test('un début de session déjà écrit n\'est pas écrit une seconde fois', () => {
  // Arrange
  const dejaEcrits = lignes({ hook_event_name: 'SessionStart', session_id: CONV });
  // Act
  const evenements = sessionStart(base, dejaEcrits, lignes(question()));
  // Assert
  expect(evenements).toEqual([]);
});

test('des outils déjà écrits n\'empêchent pas d\'écrire le début de session', () => {
  // Arrange
  const dejaEcrits = lignes({ hook_event_name: 'PreToolUse', session_id: CONV, tool_use_id: `${CONV}:2` });
  // Act
  const evenements = sessionStart(base, dejaEcrits, lignes(question()));
  // Assert
  expect(evenements).toHaveLength(1);
});

test('une heure illisible ne donne aucun début de session plutôt qu\'une durée fausse', () => {
  // Arrange
  const transcript = lignes(question({ created_at: 'hier soir' }));
  // Act
  const evenements = sessionStart(base, '', transcript);
  // Assert
  expect(evenements).toEqual([]);
});

test('un transcript qui ne s\'ouvre pas sur la question de l\'utilisateur ne donne aucun début de session', () => {
  // Arrange
  const transcript = lignes({ step_index: 0, type: 'PLANNER_RESPONSE', created_at: '2026-10-08T20:37:26Z' });
  // Act
  const evenements = sessionStart(base, '', transcript);
  // Assert
  expect(evenements).toEqual([]);
});

test('un transcript vide ne donne aucun début de session', () => {
  expect(sessionStart(base, '', '')).toEqual([]);
});

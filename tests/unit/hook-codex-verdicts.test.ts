// Les échecs de commande de Codex, lus dans son transcript au passage d'un hook.
import { expect, test } from 'vitest';
import { codexEvents } from '../../src/server/hook-codex-verdicts.ts';

const SESSION = '01a11734-208f-73c3-9388-dda0d149502e';
const lignes = (...objets: unknown[]) => objets.map(o => JSON.stringify(o)).join('\n') + '\n';

function hook(hook_event_name: string, id: string, extra: Record<string, unknown> = {}) {
  return {
    session_id: SESSION, hook_event_name, tool_name: 'Bash', tool_use_id: id,
    tool_input: { command: 'node -e "process.exit(3)"' }, cwd: 'C:/projet', transcript_path: 'C:/t.jsonl',
    ...extra,
  };
}

// Forme relevée sur des transcripts réels de Codex 0.160 et 0.162.
function execution(id: string, status: 'completed' | 'failed', exit_code: number, sortie = '') {
  return {
    timestamp: '2026-10-07T16:31:22.503Z', ordinal: 27, type: 'event_msg',
    payload: {
      type: 'item_completed', thread_id: SESSION, turn_id: '01a11734-26f7-75d2-a94f-8592f6f56778',
      item: {
        type: 'CommandExecution', id, source: 'unified_exec_startup', status,
        stdout: sortie, stderr: '', aggregated_output: sortie, exit_code, formatted_output: sortie,
      },
    },
  };
}

test('une commande sortie en code 3 rend sa fin sous forme d\'échec, avec le code et la sortie', () => {
  // Arrange
  const fin = hook('PostToolUse', 'exec-c51101c5', { tool_response: 'Code de sortie Node : 3\r\n' });
  const transcript = lignes(execution('exec-c51101c5', 'failed', 3, 'Code de sortie Node : 3\r\n'));
  // Act
  const evenements = codexEvents(fin, '', transcript);
  // Assert
  expect(evenements).toEqual([{
    ...fin, hook_event_name: 'PostToolUseFailure', error: 'Exit code 3\nCode de sortie Node : 3',
  }]);
});

test('une commande sortie en code 0 garde sa fin telle quelle', () => {
  // Arrange
  const fin = hook('PostToolUse', 'exec-e3e9e257');
  const transcript = lignes(execution('exec-e3e9e257', 'completed', 0, 'ok\r\n'));
  // Act
  const evenements = codexEvents(fin, '', transcript);
  // Assert
  expect(evenements).toEqual([fin]);
});

test('un transcript sans ligne de commande, comme celui d\'un ancien Codex, laisse l\'événement tel quel', () => {
  // Arrange
  const fin = hook('PostToolUse', 'exec-c51101c5');
  const transcript = lignes({ type: 'response_item', payload: { type: 'function_call_output', call_id: 'call_1', output: 'Exit code: 3\n' } });
  // Act
  const evenements = codexEvents(fin, '', transcript);
  // Assert
  expect(evenements).toEqual([fin]);
});

test('l\'échec d\'une autre commande ne touche pas la fin de celle-ci', () => {
  // Arrange
  const fin = hook('PostToolUse', 'exec-e3e9e257');
  const transcript = lignes(execution('exec-c51101c5', 'failed', 3), execution('exec-e3e9e257', 'completed', 0));
  // Act
  const evenements = codexEvents(fin, '', transcript);
  // Assert
  expect(evenements).toEqual([fin]);
});

test('la sortie d\'une commande en échec est bornée, et commence toujours par le code', () => {
  // Arrange
  const sortie = 'x'.repeat(20_000);
  const fin = hook('PostToolUse', 'exec-c51101c5');
  const transcript = lignes(execution('exec-c51101c5', 'failed', 1, sortie));
  // Act
  const erreur = String(codexEvents(fin, '', transcript)[0]?.error);
  // Assert
  expect(erreur.startsWith('Exit code 1\nxxx')).toBe(true);
  expect(erreur.length).toBe(4000);
});

test('une ligne coupée par le début de la fenêtre de lecture n\'empêche pas de lire les suivantes', () => {
  // Arrange
  const fin = hook('PostToolUse', 'exec-c51101c5');
  const transcript = 'pe":"CommandExecution","id":"exec-0000"}}}\n' + lignes(execution('exec-c51101c5', 'failed', 3));
  // Act
  const evenements = codexEvents(fin, '', transcript);
  // Assert
  expect(evenements[0]?.hook_event_name).toBe('PostToolUseFailure');
});

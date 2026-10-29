// Charges reprises d'une session Codex réelle, identifiants et chemins anonymisés. Codex colle
// l'espace de noms d'un outil à son nom dans `tool_name` ; sa transcription les garde séparés
// (`"name":"spawn_agent","namespace":"collaboration"`).
import { expect, test } from 'vitest';
import { NORMALIZERS } from '../../src/server/hook-normalize.ts';

function outil(toolName: string, toolInput: Record<string, unknown>): Record<string, unknown> {
  return {
    session_id: '01a189d0-0000-7000-8000-000000000001',
    turn_id: '01a189d0-0000-7000-8000-000000000002',
    transcript_path: 'C:/codex/sessions/rollout-parent.jsonl',
    cwd: 'C:/projet',
    hook_event_name: 'PreToolUse',
    model: 'gpt-6.1-sol',
    permission_mode: 'bypassPermissions',
    tool_name: toolName,
    tool_input: toolInput,
    tool_use_id: 'call_00000000000000000000000000000001',
  };
}

test('le lancement d\'un sous-agent Codex porte le nom de l\'outil, sans son espace de noms', () => {
  // Arrange
  const brut = outil('collaborationspawn_agent', { task_name: 'lecture_deleguee', message: 'chiffré' });
  // Act
  const evt = NORMALIZERS.codex(brut, undefined);
  // Assert
  expect(evt.tool_name).toBe('spawn_agent');
  expect(evt).toEqual({ ...brut, tool_name: 'spawn_agent' });
});

test('l\'attente d\'un sous-agent Codex porte le nom de l\'outil, sans son espace de noms', () => {
  // Arrange
  const brut = outil('collaborationwait_agent', { timeout_ms: 60000 });
  // Act
  const evt = NORMALIZERS.codex(brut, undefined);
  // Assert
  expect(evt.tool_name).toBe('wait_agent');
});

test('un outil Codex sans espace de noms garde son nom', () => {
  // Arrange
  const brut = outil('Bash', { command: 'ls' });
  // Act
  const evt = NORMALIZERS.codex(brut, undefined);
  // Assert
  expect(evt).toEqual(brut);
});

test('un outil MCP Codex garde son nom complet, que la vue reconnaît à son préfixe mcp__', () => {
  // Arrange
  const brut = outil('mcp__playwright__browser_click', { element: 'bouton' });
  // Act
  const evt = NORMALIZERS.codex(brut, undefined);
  // Assert
  expect(evt.tool_name).toBe('mcp__playwright__browser_click');
});

test('un événement Codex sans outil passe tel quel', () => {
  // Arrange
  const brut = { session_id: '01a189d0-0000-7000-8000-000000000001', hook_event_name: 'Stop' };
  // Act
  const evt = NORMALIZERS.codex(brut, undefined);
  // Assert
  expect(evt).toEqual(brut);
});

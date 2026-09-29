// Charges reprises d'une session agy 1.2.13 réelle, chemins anonymisés. La forme canonique est
// le vocabulaire de Claude Code, que lisent tous les consommateurs de agent-events/*.jsonl.
import { expect, test } from 'vitest';
import { NORMALIZERS, NEEDS_EVENT_FLAG, HOOK_SOURCES } from '../../src/server/hook-normalize.ts';

const CONV = 'cda6084a-faa3-40f9-8a37-91e6ece45a12';

function outil(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    conversationId: CONV,
    modelName: 'gemini-3.8-flash-high',
    stepIdx: 2,
    toolCall: { name: 'view_file', args: { AbsolutePath: 'C:\\projet\\a.txt', toolAction: 'Reading file' } },
    workspacePaths: ['C:\\projet'],
    transcriptPath: 'C:/Users/x/.gemini/antigravity-cli/brain/c/.system_generated/logs/transcript_full.jsonl',
    artifactDirectoryPath: 'C:/Users/x/.gemini/antigravity-cli/brain/c',
    ...overrides,
  };
}

test('un PreToolUse Antigravity prend le vocabulaire canonique', () => {
  // Arrange
  const brut = outil();
  // Act
  const evt = NORMALIZERS.antigravity(brut, 'PreToolUse');
  // Assert
  expect(evt.hook_event_name).toBe('PreToolUse');
  expect(evt.session_id).toBe(CONV);
  expect(evt.tool_name).toBe('view_file');
  expect(evt.tool_input).toEqual({ AbsolutePath: 'C:\\projet\\a.txt', toolAction: 'Reading file' });
  expect(evt.cwd).toBe('C:\\projet');
  expect(evt.transcript_path).toBe(brut.transcriptPath);
  expect(evt._native_event).toBe('PreToolUse');
});

test('un PreToolUse et son PostToolUse portent le même tool_use_id', () => {
  // Arrange
  const pre = NORMALIZERS.antigravity(outil(), 'PreToolUse');
  // Act
  const post = NORMALIZERS.antigravity(outil({ error: '' }), 'PostToolUse');
  // Assert
  expect(post.tool_use_id).toBe(pre.tool_use_id);
  expect(post.tool_use_id).toBe(`${CONV}:2`);
});

test('un PostToolUse sans erreur reste un succès', () => {
  // Arrange
  const brut = outil({ error: '' });
  // Act
  const evt = NORMALIZERS.antigravity(brut, 'PostToolUse');
  // Assert
  expect(evt.hook_event_name).toBe('PostToolUse');
});

test('un PostToolUse sans champ error reste un succès', () => {
  // Arrange
  const brut = outil();
  // Act
  const evt = NORMALIZERS.antigravity(brut, 'PostToolUse');
  // Assert
  expect(evt.hook_event_name).toBe('PostToolUse');
});

test('un PostToolUse avec erreur devient PostToolUseFailure, erreur recopiée', () => {
  // Arrange
  const brut = outil({ error: 'exit status 1' });
  // Act
  const evt = NORMALIZERS.antigravity(brut, 'PostToolUse');
  // Assert
  expect(evt.hook_event_name).toBe('PostToolUseFailure');
  expect(evt.error).toBe('exit status 1');
});

test('un Stop Antigravity garde son nom et sa session', () => {
  // Arrange
  const brut = { conversationId: CONV, executionNum: 0, terminationReason: 'NO_TOOL_CALL', fullyIdle: true, error: '' };
  // Act
  const evt = NORMALIZERS.antigravity(brut, 'Stop');
  // Assert
  expect(evt.hook_event_name).toBe('Stop');
  expect(evt.session_id).toBe(CONV);
  expect(evt.tool_use_id).toBe(undefined);
});

test('un événement Antigravity inconnu garde son nom brut, rien n’est deviné', () => {
  // Arrange
  const brut = { conversationId: CONV, invocationNum: 0 };
  // Act
  const evt = NORMALIZERS.antigravity(brut, 'PreInvocation');
  // Assert
  expect(evt.hook_event_name).toBe('PreInvocation');
});

test('les champs d’origine restent dans l’événement normalisé', () => {
  // Arrange
  const brut = outil();
  // Act
  const evt = NORMALIZERS.antigravity(brut, 'PreToolUse');
  // Assert
  expect(evt.conversationId).toBe(CONV);
  expect(evt.stepIdx).toBe(2);
});

test('un stepIdx à 0 produit quand même un tool_use_id', () => {
  // Arrange
  const brut = outil({ stepIdx: 0 });
  // Act
  const evt = NORMALIZERS.antigravity(brut, 'PreToolUse');
  // Assert
  expect(evt.tool_use_id).toBe(`${CONV}:0`);
});

test('une charge Claude passe inchangée', () => {
  // Arrange
  const brut = { session_id: 's1', hook_event_name: 'PreToolUse', tool_name: 'Read', tool_use_id: 't1' };
  // Act
  const evt = NORMALIZERS.claude(brut, undefined);
  // Assert
  expect(evt).toEqual(brut);
});

test('une charge Copilot passe inchangée', () => {
  // Arrange
  const brut = { session_id: 's1', hook_event_name: 'PreToolUse', tool_name: 'Read', tool_use_id: 't1' };
  // Act
  const evt = NORMALIZERS.copilot(brut, undefined);
  // Assert
  expect(evt).toEqual(brut);
});

test('seul Antigravity exige le drapeau --event', () => {
  // Arrange — les sources déclarées
  // Act
  const exigent = HOOK_SOURCES.filter(s => NEEDS_EVENT_FLAG[s]);
  // Assert
  expect(exigent).toEqual(['antigravity']);
});

// Le compteur « tools » de l'en-tête : chaque appel d'outil terminé compte une fois,
// réussi ou en échec, et les échecs se lisent à part.
import { beforeEach, expect, test } from 'vitest';
import { state, vis } from '../../src/web/viz-state.ts';
import { processEvent, type HookEvent } from '../../src/web/viz-graph.ts';
import { resetErrors } from '../../src/web/viz-errors.ts';

const SID = 'aaaa1111-0000-0000-0000-000000000000';

beforeEach(() => {
  state.nodes.clear();
  state.timelineEntries.length = 0;
  state.toolsCompleted = 0;
  state.toolsFailed = 0;
  state.toolOutcomes.clear();
  vis.nodes.clear();
  vis.runningNodes.clear();
  resetErrors();
});

function evt(hook_event_name: string, tool_use_id: string, extra: Partial<HookEvent> & { error?: string } = {}): HookEvent {
  return { hook_event_name, session_id: SID, tool_name: 'Bash', tool_use_id, _ts: '2026-01-01T00:00:00.000Z', ...extra };
}

test('un outil réussi et un outil en échec font deux outils, dont un échec', () => {
  // Arrange
  const evenements = [
    evt('PreToolUse', 'ok-1'), evt('PostToolUse', 'ok-1'),
    evt('PreToolUse', 'ko-1'), evt('PostToolUseFailure', 'ko-1', { error: 'Exit code 1' }),
  ];
  // Act
  for (const e of evenements) processEvent(e);
  // Assert
  expect([state.toolsCompleted, state.toolsFailed]).toEqual([2, 1]);
});

test('un outil annoncé fini puis déclaré en échec compte une fois, comme un échec', () => {
  // Arrange — Antigravity : fin sans verdict, puis l'échec lu plus tard dans le transcript.
  const evenements = [
    evt('PreToolUse', 'conv:2'), evt('PostToolUse', 'conv:2'),
    evt('PostToolUseFailure', 'conv:2', { error: 'The command exited with code 1.' }),
  ];
  // Act
  for (const e of evenements) processEvent(e);
  // Assert
  expect([state.toolsCompleted, state.toolsFailed]).toEqual([1, 1]);
});

test('une fin reçue deux fois ne compte qu une fois', () => {
  // Arrange
  const evenements = [
    evt('PreToolUse', 'ko-2'),
    evt('PostToolUseFailure', 'ko-2', { error: 'x' }), evt('PostToolUseFailure', 'ko-2', { error: 'x' }),
    evt('PostToolUse', 'ko-2'),
  ];
  // Act
  for (const e of evenements) processEvent(e);
  // Assert
  expect([state.toolsCompleted, state.toolsFailed]).toEqual([1, 1]);
});

test('une fin réussie qui suit un échec ne le rouvre pas', () => {
  // Arrange
  const evenements = [
    evt('PreToolUse', 'ko-3'),
    evt('PostToolUseFailure', 'ko-3', { error: 'x' }), evt('PostToolUse', 'ko-3'),
    evt('PostToolUseFailure', 'ko-3', { error: 'x' }),
  ];
  // Act
  for (const e of evenements) processEvent(e);
  // Assert
  expect([state.toolsCompleted, state.toolsFailed]).toEqual([1, 1]);
});

test('deux fins sans identifiant font deux outils', () => {
  // Arrange
  const evenements = [evt('PostToolUse', ''), evt('PostToolUseFailure', '', { error: 'x' }), evt('PostToolUse', '')];
  // Act
  for (const e of evenements) processEvent(e);
  // Assert
  expect([state.toolsCompleted, state.toolsFailed]).toEqual([3, 1]);
});

test('un échec dont le lancement n a pas été reçu compte aussi, comme le registre des erreurs', () => {
  // Arrange
  const echec = evt('PostToolUseFailure', 'orphelin', { error: 'x' });
  // Act
  processEvent(echec);
  // Assert
  expect([state.toolsCompleted, state.toolsFailed]).toEqual([1, 1]);
});

// La charge d'échec que Copilot CLI envoie se lit comme celle de Claude Code :
// un outil terminé, en échec, et une ligne au registre d'erreurs.
import { beforeEach, expect, test } from 'vitest';
import { NORMALIZERS } from '../../src/server/hook-normalize.ts';
import { state, vis } from '../../src/web/viz-state.ts';
import { processEvent, type HookEvent } from '../../src/web/viz-graph.ts';
import { getErrorsSummary, resetErrors } from '../../src/web/viz-errors.ts';

// Forme « compatible VS Code » de la référence des hooks de Copilot CLI, celle qu'il
// envoie à un fichier de hooks aux clefs PascalCase comme celui de l'installeur.
// Charge documentée, non relevée : identifiant et chemins neutres.
const ECHEC_COPILOT = {
  hook_event_name: 'PostToolUseFailure',
  session_id: 'cccc0000-0000-0000-0000-000000000040',
  timestamp: '2026-10-30T10:00:00.000Z',
  cwd: '/projet',
  tool_name: 'view',
  tool_input: { path: '/projet/absent.txt' },
  error: 'Path does not exist',
};

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

test('la charge d’échec de Copilot donne un outil en échec et une ligne au registre', () => {
  // Arrange
  const evt = { ...NORMALIZERS.copilot(ECHEC_COPILOT, undefined), _ts: ECHEC_COPILOT.timestamp } as HookEvent;

  // Act
  processEvent(evt);

  // Assert
  expect([state.toolsCompleted, state.toolsFailed, getErrorsSummary().total]).toEqual([1, 1, 1]);
});

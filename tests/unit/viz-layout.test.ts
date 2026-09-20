// Smoke test for processEvent / EVENT_HANDLERS dispatch in src/web/viz-layout.ts.
// state and vis are module-level singletons, so we reset their relevant slices
// before each test to keep tests independent.

import { beforeEach, expect, test } from 'vitest';
import { state, vis } from '../../src/web/viz-state.ts';
import { processEvent, layoutDirtyRoots, calcDuration, type HookEvent } from '../../src/web/viz-layout.ts';
import { getErrors, resetErrors, onErrorsChanged } from '../../src/web/viz-errors.ts';

function resetState() {
  state.nodes.clear();
  state.timelineEntries.length = 0;
  state.eventSeq = 0;
  state.startTimes.clear();
  state.forkedAgentParents.clear();
  vis.nodes.clear();
  vis.runningNodes.clear();
  vis.drawSessionNodes.length = 0;
  vis.drawAgentNodes.length = 0;
  vis.drawToolNodes.length = 0;
  vis.drawSkillNodes.length = 0;
  vis.drawMcpNodes.length = 0;
  layoutDirtyRoots.clear();
  resetErrors();
}

beforeEach(resetState);

test('processEvent SessionStart creates a running session node + timeline entry', () => {
  const sid = 'abc12345-0000-0000-0000-000000000000';
  processEvent({
    hook_event_name: 'SessionStart',
    session_id: sid,
    _ts: '2025-01-01T00:00:00.000Z',
  });

  const node = state.nodes.get(`s:${sid}`);
  expect(node, 'session node should exist').toBeTruthy();
  expect(node!.type).toBe('session');
  expect(node!.status).toBe('running');
  expect(node!.label).toBe('Session');
  expect(node!.sub).toBe(sid.slice(0, 8));
  expect(node!.startTime).toBe('2025-01-01T00:00:00.000Z');
  expect(vis.runningNodes.has(node!.id), 'should be tracked as running in vis').toBeTruthy();

  expect(state.timelineEntries.length).toBe(1);
  expect(state.timelineEntries[0]!.nodeId).toBe(node!.id);
  expect(state.timelineEntries[0]!.type).toBe('session');
});

// ─── calcDuration — la durée telle que la carte du graphe l'écrit ──────────
// Le format lui-même est éprouvé dans viz-duration.test.ts. Ce qui se joue ici
// est le passage par ce module (une durée nominale sort bien formatée) et la
// traduction propre à cette vue : `null`, que le canevas et le panneau de détail
// savent taire.

test('une durée nominale s écrit ici comme partout ailleurs', () => {
  // Arrange
  const debut = '2025-01-01T00:00:00.000Z';
  const fin = '2025-01-01T00:00:01.500Z';

  // Act
  const rendu = calcDuration(debut, fin);

  // Assert
  expect(rendu).toBe('1.5s');
});

test('une date illisible ne met jamais « NaNm » sur la carte', () => {
  // Arrange — une date de fin illisible
  const debut = '2025-01-01T00:00:00.000Z';

  // Act
  const rendu = calcDuration(debut, 'pas-une-date');

  // Assert
  expect(rendu).toBe(null);
});

// ─── L'échec d'un outil entre au registre, noeud ou pas ─────────────────────
// Le registre capte à l'événement, hors de tout `if (n)` : un échec dont le noeud
// manque — `PreToolUse` non reçu, noeud déjà ramassé — est compté et tracé quand
// même. Ces tests interdisent de le remettre sous la garde du noeud.

test('un échec dont le noeud existe marque le noeud ET entre au registre', () => {
  // Arrange
  const sid = 'abc12345-0000-0000-0000-000000000000';
  processEvent({
    hook_event_name: 'PreToolUse', session_id: sid, tool_name: 'Read',
    tool_input: { file_path: 'C:\\dev\\note.md' }, tool_use_id: 'tu-1',
    _ts: '2025-01-01T00:00:00.000Z',
  });

  // Act
  processEvent({
    hook_event_name: 'PostToolUseFailure', session_id: sid, tool_name: 'Read',
    tool_input: { file_path: 'C:\\dev\\note.md' }, tool_use_id: 'tu-1',
    error: 'File content exceeds maximum allowed tokens',
    _ts: '2025-01-01T00:00:01.000Z',
  } as HookEvent);

  // Assert
  expect(state.nodes.get('t:tu-1')!.status).toBe('error');
  const recs = getErrors();
  expect(recs.length).toBe(1);
  expect(recs[0]!.nodeId).toBe('t:tu-1');
  expect(recs[0]!.message).toMatch(/exceeds maximum/);
});

test('quand le registre prévient, le noeud porte DÉJÀ le statut error', () => {
  // Défaut trouvé sur données RÉELLES, invisible sur un cas à une seule erreur :
  // l'abonné du registre repeint le flux, et la couleur d'une ligne se décide
  // au statut de son noeud. Enregistrer AVANT de marquer le noeud faisait
  // repeindre trop tôt — la ligne gardait la couleur de son type. L'erreur
  // suivante rattrapait la précédente en la repeignant, si bien que seule la
  // DERNIÈRE restait fausse : sur une session à une erreur, tout semblait juste.
  // Arrange
  const sid = 'abc12345-0000-0000-0000-000000000000';
  processEvent({
    hook_event_name: 'PreToolUse', session_id: sid, tool_name: 'Read',
    tool_input: { file_path: 'C:\\dev\\note.md' }, tool_use_id: 'tu-ordre',
    _ts: '2025-01-01T00:00:00.000Z',
  });
  let statutVuParLAbonne = null;
  const desabonner = onErrorsChanged(() => {
    const n = state.nodes.get('t:tu-ordre');
    statutVuParLAbonne = n ? n.status : '(aucun noeud)';
  });

  // Act
  processEvent({
    hook_event_name: 'PostToolUseFailure', session_id: sid, tool_name: 'Read',
    tool_input: { file_path: 'C:\\dev\\note.md' }, tool_use_id: 'tu-ordre',
    error: 'boum', _ts: '2025-01-01T00:00:01.000Z',
  } as HookEvent);
  desabonner();

  // Assert
  expect(statutVuParLAbonne).toBe('error');
});

test('un échec SANS noeud correspondant entre quand même au registre', () => {
  // Arrange — aucun PreToolUse : c'est le cas orphelin.
  const sid = 'abc12345-0000-0000-0000-000000000000';

  // Act
  processEvent({
    hook_event_name: 'PostToolUseFailure', session_id: sid, tool_name: 'Bash',
    tool_input: { command: 'npm run build' }, tool_use_id: 'jamais-ouvert',
    error: 'Exit code 1',
    _ts: '2025-01-01T00:00:02.000Z',
  } as HookEvent);

  // Assert
  expect(state.nodes.get('t:jamais-ouvert'), 'aucun noeud, comme attendu').toBe(undefined);
  const recs = getErrors();
  expect(recs.length, 'et pourtant l échec est consigné').toBe(1);
  expect(recs[0]!.toolName).toBe('Bash');
  expect(recs[0]!.subject).toBe('npm run build');
});

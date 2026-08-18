// Smoke test for processEvent / EVENT_HANDLERS dispatch in src/web/viz-layout.js.
// state and vis are module-level singletons, so we reset their relevant slices
// before each test to keep tests independent.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { state, vis } from '../../src/web/viz-state.js';
import { processEvent, layoutDirtyRoots, calcDuration } from '../../src/web/viz-layout.js';
import { getErrors, resetErrors, onErrorsChanged } from '../../src/web/viz-errors.mjs';

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
  assert.ok(node, 'session node should exist');
  assert.equal(node.type, 'session');
  assert.equal(node.status, 'running');
  assert.equal(node.label, 'Session');
  assert.equal(node.sub, sid.slice(0, 8));
  assert.equal(node.startTime, '2025-01-01T00:00:00.000Z');
  assert.ok(vis.runningNodes.has(node.id), 'should be tracked as running in vis');

  assert.equal(state.timelineEntries.length, 1);
  assert.equal(state.timelineEntries[0].nodeId, node.id);
  assert.equal(state.timelineEntries[0].type, 'session');
});

// ─── calcDuration — la durée telle que la carte du graphe l'écrit ──────────
// Le format lui-même est éprouvé dans viz-duration.test.mjs. Ce qui se joue ici
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
  assert.equal(rendu, '1.5s');
});

test('une date illisible ne met plus « NaNm » sur la carte', () => {
  // Arrange — constat C8 : avant la mise en commun, cette entrée produisait
  // littéralement la chaîne « NaNm » à l'écran, là où le narrateur, lui,
  // refusait déjà de l'écrire.
  const debut = '2025-01-01T00:00:00.000Z';

  // Act
  const rendu = calcDuration(debut, 'pas-une-date');

  // Assert
  assert.equal(rendu, null);
});

// ─── L'échec d'un outil entre au registre, noeud ou pas ─────────────────────
// `onPostToolUseFailure` faisait tout son travail sous un `if (n)`. Un échec
// dont le noeud manque — `PreToolUse` non reçu, noeud déjà ramassé — n'était
// alors compté ni tracé nulle part. Le registre capte à l'événement ; ces deux
// tests interdisent le retour en arrière.

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
  });

  // Assert
  assert.equal(state.nodes.get('t:tu-1').status, 'error');
  const recs = getErrors();
  assert.equal(recs.length, 1);
  assert.equal(recs[0].nodeId, 't:tu-1');
  assert.match(recs[0].message, /exceeds maximum/);
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
  });
  desabonner();

  // Assert
  assert.equal(statutVuParLAbonne, 'error');
});

test('un échec SANS noeud correspondant entre quand même au registre', () => {
  // Arrange — aucun PreToolUse : c'est le cas orphelin, invisible avant.
  const sid = 'abc12345-0000-0000-0000-000000000000';

  // Act
  processEvent({
    hook_event_name: 'PostToolUseFailure', session_id: sid, tool_name: 'Bash',
    tool_input: { command: 'npm run build' }, tool_use_id: 'jamais-ouvert',
    error: 'Exit code 1',
    _ts: '2025-01-01T00:00:02.000Z',
  });

  // Assert
  assert.equal(state.nodes.get('t:jamais-ouvert'), undefined, 'aucun noeud, comme attendu');
  const recs = getErrors();
  assert.equal(recs.length, 1, 'et pourtant l échec est consigné');
  assert.equal(recs[0].toolName, 'Bash');
  assert.equal(recs[0].subject, 'npm run build');
});

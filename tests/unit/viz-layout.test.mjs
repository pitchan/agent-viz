// Smoke test for processEvent / EVENT_HANDLERS dispatch in public/viz-layout.js.
// state and vis are module-level singletons, so we reset their relevant slices
// before each test to keep tests independent.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { state, vis } from '../../public/viz-state.js';
import { processEvent, layoutDirtyRoots, calcDuration } from '../../public/viz-layout.js';

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

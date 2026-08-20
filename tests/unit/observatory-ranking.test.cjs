'use strict';
// Ranking: cost weighted by confidence, split by cost basis, with freshness
// and the "+50 % before a decided recommendation comes back" rule (doc/44) —
// accepted and ignored share the return rail, arbitrated never returns alone.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { scoreOf, isEligible, isStale, rankByBasis, CONFIDENCE_WEIGHT, RETURN_FACTOR }
  = require('../../src/server/observatory/rules/ranking.ts');

const SCAN = '2026-07-15T12:00:00.000Z';

const rec = (id, over = {}) => ({
  id, ruleId: 'R1', subject: `s${id}`, title: `t${id}`, category: 'modele',
  confidence: 'fait', estimatedCostUsd: 10, costBasis: 'jetons-mesures',
  evidence: {}, action: 'a', status: 'new', costAtStatusUsd: null,
  statusReason: null, statusAt: null,
  createdAt: '2026-07-01T00:00:00.000Z', updatedAt: SCAN, lastSeenAt: SCAN,
  ...over,
});

test('the three confidence weights are the ones the spec fixes', () => {
  assert.deepEqual(CONFIDENCE_WEIGHT, { fait: 1, correlation: 0.6, hypothese: 0.3 });
  assert.equal(RETURN_FACTOR, 1.5);
});

test('score is cost weighted by confidence', () => {
  assert.equal(scoreOf(rec(1)), 10);
  assert.equal(scoreOf(rec(2, { confidence: 'correlation' })), 6);
  assert.equal(scoreOf(rec(3, { confidence: 'hypothese' })), 3);
});

test('an unknown confidence scores zero rather than crashing the page', () => {
  assert.equal(scoreOf(rec(4, { confidence: 'inconnue' })), 0);
});

test('une adoption revient seulement passé +50 % de son coût au moment du clic (doc/44)', () => {
  assert.equal(isEligible(rec(1, { status: 'accepted', estimatedCostUsd: 14, costAtStatusUsd: 10 })), false);
  assert.equal(isEligible(rec(2, { status: 'accepted', estimatedCostUsd: 15, costAtStatusUsd: 10 })), true);
});

test('une adoption sans coût de référence reste au journal — jamais deviné', () => {
  assert.equal(isEligible(rec(1, { status: 'accepted', estimatedCostUsd: 99, costAtStatusUsd: null })), false);
});

test('an ignored recommendation returns only past +50 % of its cost at decision time', () => {
  assert.equal(isEligible(rec(1, { status: 'ignored', estimatedCostUsd: 14, costAtStatusUsd: 10 })), false);
  assert.equal(isEligible(rec(2, { status: 'ignored', estimatedCostUsd: 15, costAtStatusUsd: 10 })), true);
  assert.equal(isEligible(rec(3, { status: 'ignored', estimatedCostUsd: 99, costAtStatusUsd: null })), false);
});

test('a recommendation not re-emitted by the latest scan is stale', () => {
  assert.equal(isStale(rec(1), SCAN), false);
  assert.equal(isStale(rec(2, { lastSeenAt: '2026-07-01T00:00:00.000Z' }), SCAN), true);
  assert.equal(isStale(rec(3, { lastSeenAt: null }), SCAN), true);
  assert.equal(isStale(rec(4), null), false, 'no scan recorded yet: nothing is stale');
});

// ─── The homogeneity rule, as code ────────────────────────────────────────

test('measured-token and byte-approximated recommendations never share a list', () => {
  const { groups } = rankByBasis([
    rec(1, { estimatedCostUsd: 5, costBasis: 'jetons-mesures' }),
    rec(2, { estimatedCostUsd: 90, costBasis: 'octets-approx-4o-par-jeton' }),
  ], { lastScanAt: SCAN });
  assert.deepEqual(groups.map(g => g.basis), ['jetons-mesures', 'octets-approx-4o-par-jeton']);
  assert.deepEqual(groups[0].all.map(r => r.id), [1]);
  assert.deepEqual(groups[1].all.map(r => r.id), [2]);
});

test('a basis with no recommendation produces no empty group', () => {
  const { groups } = rankByBasis([rec(1)], { lastScanAt: SCAN });
  assert.deepEqual(groups.map(g => g.basis), ['jetons-mesures']);
});

test('within a basis, a correlation outranks a fact only when its cost is high enough', () => {
  const { groups } = rankByBasis([
    rec(1, { estimatedCostUsd: 10, confidence: 'fait' }),
    rec(2, { estimatedCostUsd: 20, confidence: 'correlation' }),
  ], { lastScanAt: SCAN });
  assert.deepEqual(groups[0].priority.map(r => r.id), [2, 1], '12 beats 10');
});

test('priority keeps at most three per basis, all keeps everything in the same order', () => {
  const input = [10, 50, 30, 40, 20].map((usd, i) => rec(i + 1, { estimatedCostUsd: usd }));
  const { groups } = rankByBasis(input, { lastScanAt: SCAN });
  assert.deepEqual(groups[0].priority.map(r => r.estimatedCostUsd), [50, 40, 30]);
  assert.deepEqual(groups[0].all.map(r => r.estimatedCostUsd), [50, 40, 30, 20, 10]);
});

test('stale recommendations leave the groups entirely and are listed apart', () => {
  const { groups, stale } = rankByBasis([
    rec(1, { estimatedCostUsd: 99, lastSeenAt: '2026-07-01T00:00:00.000Z' }),
    rec(2, { estimatedCostUsd: 5 }),
  ], { lastScanAt: SCAN });
  assert.deepEqual(groups[0].all.map(r => r.id), [2]);
  assert.deepEqual(stale.map(r => r.id), [1]);
});

test('when every score in a basis is zero the block still proposes something', () => {
  const { groups } = rankByBasis([
    rec(1, { estimatedCostUsd: 0 }), rec(2, { estimatedCostUsd: 0 }),
  ], { lastScanAt: SCAN });
  assert.deepEqual(groups[0].priority.map(r => r.id), [1, 2]);
});

test('an empty input yields empty structures, never undefined', () => {
  assert.deepEqual(rankByBasis([], { lastScanAt: SCAN }), { groups: [], stale: [], decided: [] });
});

// ─── Le registre de décisions (doc/44) : trois destinations, un journal ────

test('un arbitrage ne revient jamais de lui-même, quel que soit le coût', () => {
  assert.equal(isEligible(rec(1, { status: 'arbitrated', estimatedCostUsd: 99, costAtStatusUsd: 1 })), false);
});

test('une carte décidée sous son seuil de retour quitte les groupes pour le journal', () => {
  // Arrange
  const input = [
    rec(1, { estimatedCostUsd: 12, status: 'accepted', costAtStatusUsd: 10, statusAt: '2026-07-10T00:00:00.000Z' }),
    rec(2, { estimatedCostUsd: 12, status: 'ignored', costAtStatusUsd: 10, statusAt: '2026-07-11T00:00:00.000Z' }),
    rec(3),
  ];
  // Act
  const { groups, decided } = rankByBasis(input, { lastScanAt: SCAN });
  // Assert
  assert.deepEqual(groups[0].all.map(r => r.id), [3], 'ni en priorité ni dans « autres »');
  assert.deepEqual(decided.map(r => r.id), [2, 1], 'au journal, décision la plus récente d’abord');
});

test('une carte décidée dont le coût a regrossi de moitié re-surface dans les groupes, statut intact', () => {
  // Arrange
  const input = [
    rec(1, { estimatedCostUsd: 15, status: 'accepted', costAtStatusUsd: 10, statusAt: '2026-07-10T00:00:00.000Z' }),
    rec(2, { estimatedCostUsd: 16, status: 'ignored', costAtStatusUsd: 10, statusAt: '2026-07-11T00:00:00.000Z' }),
  ];
  // Act
  const { groups, decided } = rankByBasis(input, { lastScanAt: SCAN });
  // Assert
  assert.deepEqual(groups[0].priority.map(r => r.id), [2, 1], 'le retour passe par le rang normal');
  assert.deepEqual(groups[0].priority.map(r => r.status), ['ignored', 'accepted'],
    'le statut voyage jusqu’à la page — c’est lui qui choisit le bandeau');
  assert.deepEqual(decided, [], 'une carte re-surfacée n’est plus au journal');
});

test('les cartes arbitrées quittent les groupes et vivent au journal', () => {
  // Arrange
  const input = [
    rec(1, { status: 'arbitrated', statusAt: '2026-07-10T00:00:00.000Z', statusReason: 'déjà pesé' }),
    rec(2),
  ];
  // Act
  const { groups, decided } = rankByBasis(input, { lastScanAt: SCAN });
  // Assert
  assert.deepEqual(groups[0].all.map(r => r.id), [2], 'ni en priorité ni dans « autres »');
  assert.deepEqual(decided.map(r => r.id), [1]);
  assert.equal(decided[0].statusReason, 'déjà pesé', 'la raison voyage jusqu’à la page');
});

test('la décision prime sur la fraîcheur — une carte décidée non ré-émise reste au journal', () => {
  // Arrange : trois statuts décidés, tous plus vus depuis le dernier scan.
  const input = [
    rec(1, { status: 'arbitrated', statusAt: '2026-07-10T00:00:00.000Z', lastSeenAt: '2026-07-01T00:00:00.000Z' }),
    rec(2, { status: 'accepted', costAtStatusUsd: 10, statusAt: '2026-07-11T00:00:00.000Z', lastSeenAt: '2026-07-01T00:00:00.000Z' }),
    rec(3, { status: 'ignored', costAtStatusUsd: 10, statusAt: '2026-07-12T00:00:00.000Z', lastSeenAt: '2026-07-01T00:00:00.000Z' }),
  ];
  // Act
  const { stale, decided } = rankByBasis(input, { lastScanAt: SCAN });
  // Assert
  assert.deepEqual(stale, [], 'jamais dans « ne se produit plus »');
  assert.deepEqual(decided.map(r => r.id), [3, 2, 1]);
});

test('le journal mêle les trois statuts, du plus récent au plus ancien', () => {
  // Arrange
  const input = [
    rec(1, { status: 'arbitrated', statusAt: '2026-07-05T00:00:00.000Z' }),
    rec(2, { status: 'accepted', costAtStatusUsd: 10, statusAt: '2026-07-12T00:00:00.000Z' }),
    rec(3, { status: 'ignored', costAtStatusUsd: 10, statusAt: '2026-07-08T00:00:00.000Z' }),
  ];
  // Act
  const { decided } = rankByBasis(input, { lastScanAt: SCAN });
  // Assert
  assert.deepEqual(decided.map(r => r.id), [2, 3, 1]);
});

test('the module exposes no way to total costs across recommendations', () => {
  const api = require('../../src/server/observatory/rules/ranking.ts');
  assert.deepEqual(Object.keys(api).filter(k => /total|sum/i.test(k)), [],
    'recommendation costs overlap: a same session feeds several rules, so no total is meaningful');
});

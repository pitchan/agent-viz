// Ranking: cost weighted by confidence, split by cost basis, with freshness
// and the "+50 % before a decided recommendation comes back" rule —
// accepted and ignored share the return rail, arbitrated never returns alone.

import { expect, test } from 'vitest';
import { scoreOf, isEligible, isStale, rankByBasis, CONFIDENCE_WEIGHT, RETURN_FACTOR } from '../../src/server/observatory/rules/ranking.ts';
import * as rankingModule from '../../src/server/observatory/rules/ranking.ts';

const SCAN = '2026-07-15T12:00:00.000Z';

// RankedRecommendation (ranking.ts) n'est pas exporte : derive du parametre
// reel de scoreOf, qui le prend tel quel.
type Rec = Parameters<typeof scoreOf>[0];

const rec = (id: number, over: Partial<Rec> = {}): Rec => ({
  id, ruleId: 'R1', subject: `s${id}`, title: `t${id}`, category: 'modele',
  confidence: 'fait', estimatedCostUsd: 10, costBasis: 'jetons-mesures',
  evidence: {}, action: 'a', status: 'new', costAtStatusUsd: null,
  statusReason: null, statusAt: null,
  createdAt: '2026-07-01T00:00:00.000Z', updatedAt: SCAN, lastSeenAt: SCAN,
  ...over,
});

test('the three confidence weights are the ones the spec fixes', () => {
  expect(CONFIDENCE_WEIGHT).toEqual({ fait: 1, correlation: 0.6, hypothese: 0.3 });
  expect(RETURN_FACTOR).toBe(1.5);
});

test('score is cost weighted by confidence', () => {
  expect(scoreOf(rec(1))).toBe(10);
  expect(scoreOf(rec(2, { confidence: 'correlation' }))).toBe(6);
  expect(scoreOf(rec(3, { confidence: 'hypothese' }))).toBe(3);
});

test('an unknown confidence scores zero rather than crashing the page', () => {
  expect(scoreOf(rec(4, { confidence: 'inconnue' }))).toBe(0);
});

test('une adoption revient seulement passé +50 % de son coût au moment du clic', () => {
  expect(isEligible(rec(1, { status: 'accepted', estimatedCostUsd: 14, costAtStatusUsd: 10 }))).toBe(false);
  expect(isEligible(rec(2, { status: 'accepted', estimatedCostUsd: 15, costAtStatusUsd: 10 }))).toBe(true);
});

test('une adoption sans coût de référence reste au journal — jamais deviné', () => {
  expect(isEligible(rec(1, { status: 'accepted', estimatedCostUsd: 99, costAtStatusUsd: null }))).toBe(false);
});

test('an ignored recommendation returns only past +50 % of its cost at decision time', () => {
  expect(isEligible(rec(1, { status: 'ignored', estimatedCostUsd: 14, costAtStatusUsd: 10 }))).toBe(false);
  expect(isEligible(rec(2, { status: 'ignored', estimatedCostUsd: 15, costAtStatusUsd: 10 }))).toBe(true);
  expect(isEligible(rec(3, { status: 'ignored', estimatedCostUsd: 99, costAtStatusUsd: null }))).toBe(false);
});

test('une carte décidée à coût nul ne revient que si un coût apparaît', () => {
  expect(isEligible(rec(1, { status: 'accepted', estimatedCostUsd: 0, costAtStatusUsd: 0 }))).toBe(false);
  expect(isEligible(rec(2, { status: 'accepted', estimatedCostUsd: 0.5, costAtStatusUsd: 0 }))).toBe(true);
  expect(isEligible(rec(3, { status: 'ignored', estimatedCostUsd: 0, costAtStatusUsd: 0 }))).toBe(false);
});

test('a recommendation not re-emitted by the latest scan is stale', () => {
  expect(isStale(rec(1), SCAN)).toBe(false);
  expect(isStale(rec(2, { lastSeenAt: '2026-07-01T00:00:00.000Z' }), SCAN)).toBe(true);
  expect(isStale(rec(3, { lastSeenAt: null }), SCAN)).toBe(true);
  expect(isStale(rec(4), null), 'no scan recorded yet: nothing is stale').toBe(false);
});

// ─── The homogeneity rule, as code ────────────────────────────────────────

test('measured-token and byte-approximated recommendations never share a list', () => {
  const { groups } = rankByBasis([
    rec(1, { estimatedCostUsd: 5, costBasis: 'jetons-mesures' }),
    rec(2, { estimatedCostUsd: 90, costBasis: 'octets-approx-4o-par-jeton' }),
  ], { lastScanAt: SCAN });
  expect(groups.map(g => g.basis)).toEqual(['jetons-mesures', 'octets-approx-4o-par-jeton']);
  expect(groups[0]!.all.map(r => r.id)).toEqual([1]);
  expect(groups[1]!.all.map(r => r.id)).toEqual([2]);
});

test('a basis with no recommendation produces no empty group', () => {
  const { groups } = rankByBasis([rec(1)], { lastScanAt: SCAN });
  expect(groups.map(g => g.basis)).toEqual(['jetons-mesures']);
});

test('within a basis, a correlation outranks a fact only when its cost is high enough', () => {
  const { groups } = rankByBasis([
    rec(1, { estimatedCostUsd: 10, confidence: 'fait' }),
    rec(2, { estimatedCostUsd: 20, confidence: 'correlation' }),
  ], { lastScanAt: SCAN });
  expect(groups[0]!.priority.map(r => r.id), '12 beats 10').toEqual([2, 1]);
});

test('priority keeps at most three per basis, all keeps everything in the same order', () => {
  const input = [10, 50, 30, 40, 20].map((usd, i) => rec(i + 1, { estimatedCostUsd: usd }));
  const { groups } = rankByBasis(input, { lastScanAt: SCAN });
  expect(groups[0]!.priority.map(r => r.estimatedCostUsd)).toEqual([50, 40, 30]);
  expect(groups[0]!.all.map(r => r.estimatedCostUsd)).toEqual([50, 40, 30, 20, 10]);
});

test('stale recommendations leave the groups entirely and are listed apart', () => {
  const { groups, stale } = rankByBasis([
    rec(1, { estimatedCostUsd: 99, lastSeenAt: '2026-07-01T00:00:00.000Z' }),
    rec(2, { estimatedCostUsd: 5 }),
  ], { lastScanAt: SCAN });
  expect(groups[0]!.all.map(r => r.id)).toEqual([2]);
  expect(stale.map(r => r.id)).toEqual([1]);
});

test('when every score in a basis is zero the block still proposes something', () => {
  const { groups } = rankByBasis([
    rec(1, { estimatedCostUsd: 0 }), rec(2, { estimatedCostUsd: 0 }),
  ], { lastScanAt: SCAN });
  expect(groups[0]!.priority.map(r => r.id)).toEqual([1, 2]);
});

test('an empty input yields empty structures, never undefined', () => {
  expect(rankByBasis([], { lastScanAt: SCAN })).toEqual({ groups: [], stale: [], decided: [] });
});

// ─── Le registre de décisions : trois destinations, un journal ─────────────

test('un arbitrage ne revient jamais de lui-même, quel que soit le coût', () => {
  expect(isEligible(rec(1, { status: 'arbitrated', estimatedCostUsd: 99, costAtStatusUsd: 1 }))).toBe(false);
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
  expect(groups[0]!.all.map(r => r.id), 'ni en priorité ni dans « autres »').toEqual([3]);
  expect(decided.map(r => r.id), 'au journal, décision la plus récente d’abord').toEqual([2, 1]);
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
  expect(groups[0]!.priority.map(r => r.id), 'le retour passe par le rang normal').toEqual([2, 1]);
  expect(groups[0]!.priority.map(r => r.status), 'le statut voyage jusqu’à la page — c’est lui qui choisit le bandeau').toEqual(['ignored', 'accepted']);
  expect(decided, 'une carte re-surfacée n’est plus au journal').toEqual([]);
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
  expect(groups[0]!.all.map(r => r.id), 'ni en priorité ni dans « autres »').toEqual([2]);
  expect(decided.map(r => r.id)).toEqual([1]);
  expect(decided[0]!.statusReason, 'la raison voyage jusqu’à la page').toBe('déjà pesé');
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
  expect(stale, 'jamais dans « ne se produit plus »').toEqual([]);
  expect(decided.map(r => r.id)).toEqual([3, 2, 1]);
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
  expect(decided.map(r => r.id)).toEqual([2, 3, 1]);
});

test('the module exposes no way to total costs across recommendations', () => {
  const api = rankingModule;
  expect(Object.keys(api).filter(k => /total|sum/i.test(k)), 'recommendation costs overlap: a same session feeds several rules, so no total is meaningful').toEqual([]);
});

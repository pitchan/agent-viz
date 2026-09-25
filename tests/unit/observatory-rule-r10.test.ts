// R10 — un skill que seul l'utilisateur lance garde sa description dans la liste à chaque tour.
import { expect, test } from 'vitest';
import * as r10 from '../../src/server/observatory/rules/r10-user-only-skill.ts';
import { listed, skillSession } from '../helpers/skill-sessions.ts';

test('tapé 3 fois, jamais appelé par Claude, décrit dans la liste : une carte', () => {
  // Arrange
  const sessions = [
    skillSession('s1', { typed: { 'code-review': 2 }, listing: [listed('code-review', 853)] }),
    skillSession('s2', { typed: { 'code-review': 1 }, listing: [listed('code-review', 853)] }),
    skillSession('old', null),
  ];
  // Act
  const recs = r10.evaluate({ sessions, configItems: [] });
  // Assert
  expect(recs.length).toBe(1);
  expect(recs[0]).toMatchObject({
    ruleId: 'R10', subject: 'code-review', category: 'skills', estimatedCostUsd: 0, costBasis: 'non-chiffre',
    title: 'Skill « code-review » lancé seulement à la main, sa description reste dans la liste',
  });
  expect(recs[0]!.evidence).toEqual({
    sessions: ['s1', 's2'], typedCount: 3, entryChars: 853, excludedPendingRescan: 1,
  });
});

test('un seul appel de Claude sur la période suffit à taire la règle', () => {
  // Arrange
  const sessions = [
    skillSession('s1', { typed: { pptx: 3 }, listing: [listed('pptx')] }),
    skillSession('s2', { calls: { pptx: 1 }, listing: [listed('pptx')] }),
  ];
  // Act / Assert
  expect(r10.evaluate({ sessions, configItems: [] })).toEqual([]);
});

test('sous le seuil, ou sans description dans la liste : aucune carte', () => {
  // Arrange
  const sessions = [
    skillSession('s1', { typed: { pptx: 2, clear: 5, init: 4 }, listing: [listed('pptx'), listed('init', 6, false)] }),
  ];
  // Act / Assert
  expect(r10.evaluate({ sessions, configItems: [] })).toEqual([]);
});

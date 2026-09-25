// R8 — la liste des skills a dépassé son plafond : Claude Code a retiré des descriptions.
import { expect, test } from 'vitest';
import * as r8 from '../../src/server/observatory/rules/r8-hidden-descriptions.ts';
import { listed, skillSession } from '../helpers/skill-sessions.ts';

test('une description retirée produit une seule carte, sans coût, avec les skills masqués', () => {
  // Arrange
  const sessions = [
    skillSession('s1', { listing: [listed('docx', 500), listed('init', 6, false), listed('pptx', 23, false)] }),
    skillSession('s2', { listing: [listed('docx', 500), listed('init', 6, false)] }),
    skillSession('s3', { listing: [listed('docx', 500)] }),
    skillSession('old', null),
  ];
  // Act
  const recs = r8.evaluate({ sessions, configItems: [] });
  // Assert
  expect(recs.length).toBe(1);
  expect(recs[0]).toMatchObject({
    ruleId: 'R8', subject: 'liste-des-skills', category: 'skills', confidence: 'fait',
    estimatedCostUsd: 0, costBasis: 'jetons-mesures',
    title: 'Liste des skills au plafond : 2 descriptions retirées',
  });
  expect(recs[0]!.evidence).toEqual({
    sessions: ['s1', 's2'],
    hidden: [{ name: 'init', sessions: 2 }, { name: 'pptx', sessions: 1 }],
    sessionsAnalysed: 3,
    largestListingChars: 529,
    excludedPendingRescan: 1,
    costComplete: true,
  });
});

test('aucune description retirée : aucune carte', () => {
  // Arrange
  const sessions = [skillSession('s1', { listing: [listed('docx')] })];
  // Act / Assert
  expect(r8.evaluate({ sessions, configItems: [] })).toEqual([]);
});

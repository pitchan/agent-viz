// R11 — le texte d'un skill chargé dépasse la longueur conseillée par Anthropic.
import { expect, test } from 'vitest';
import * as r11 from '../../src/server/observatory/rules/r11-heavy-skill-body.ts';
import { skillSession } from '../helpers/skill-sessions.ts';

const body = (skill: string, lines: number, bytes: number) => ({ skill, lines, bytes, by: 'model' as const });

test('un texte de plus de 500 lignes produit une carte chiffrée depuis les octets', () => {
  // Arrange
  const sessions = [
    skillSession('s1', { bodies: [body('dataviz', 620, 40000), body('pptx', 120, 5000)] }, { costUsd: 10, netTokens: 100000 }),
    skillSession('s2', { bodies: [body('dataviz', 620, 40000)] }, { costUsd: 10, netTokens: 100000 }),
    skillSession('old', null),
  ];
  // Act
  const recs = r11.evaluate({ sessions, configItems: [] });
  // Assert
  expect(recs.length).toBe(1);
  expect(recs[0]).toMatchObject({
    ruleId: 'R11', subject: 'dataviz', category: 'skills', costBasis: 'octets-approx-4o-par-jeton',
    title: 'Skill « dataviz » : 620 lignes chargées en une fois',
  });
  expect(recs[0]!.estimatedCostUsd).toBeCloseTo(2, 6);
  expect(recs[0]!.evidence).toEqual({
    sessions: ['s1', 's2'], invocations: 2, maxLines: 620, bytes: 80000, excludedPendingRescan: 1, costComplete: true,
  });
});

test('500 lignes pile : aucune carte', () => {
  // Arrange
  const sessions = [skillSession('s1', { bodies: [body('pptx', 500, 20000)] })];
  // Act / Assert
  expect(r11.evaluate({ sessions, configItems: [] })).toEqual([]);
});

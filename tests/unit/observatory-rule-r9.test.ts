// R9 — un même skill figure plusieurs fois dans la liste sous des préfixes différents.
import { expect, test } from 'vitest';
import * as r9 from '../../src/server/observatory/rules/r9-duplicate-skills.ts';
import { listed, skillSession } from '../helpers/skill-sessions.ts';

test('deux copies du même nom de base produisent une carte par nom de base', () => {
  // Arrange
  const sessions = [
    skillSession('s1', { listing: [listed('anthropic-skills:docx', 959), listed('docx', 793), listed('pptx', 50)] }),
    skillSession('s2', { listing: [listed('docx', 793)] }),
    skillSession('old', null),
  ];
  // Act
  const recs = r9.evaluate({ sessions, configItems: [] });
  // Assert
  expect(recs.length).toBe(1);
  expect(recs[0]).toMatchObject({
    ruleId: 'R9', subject: 'docx', category: 'skills', estimatedCostUsd: 0, costBasis: 'non-chiffre',
    title: 'Skill « docx » présent 2 fois dans la liste',
  });
  expect(recs[0]!.evidence).toEqual({
    sessions: ['s1'],
    copies: [{ name: 'anthropic-skills:docx', chars: 959 }, { name: 'docx', chars: 793 }],
    excludedPendingRescan: 1,
  });
});

test('des noms de base distincts : aucune carte', () => {
  // Arrange
  const sessions = [skillSession('s1', { listing: [listed('docx'), listed('pptx')] })];
  // Act / Assert
  expect(r9.evaluate({ sessions, configItems: [] })).toEqual([]);
});

test('le compte du titre est le pire tour, pas l\'union des noms vus sur la période', () => {
  // Arrange
  const sessions = [
    skillSession('s1', { listing: [listed('docx'), listed('a:docx')] }),
    skillSession('s2', { listing: [listed('docx'), listed('b:docx')] }),
  ];
  // Act
  const recs = r9.evaluate({ sessions, configItems: [] });
  // Assert
  expect(recs[0]!.title).toBe('Skill « docx » présent 2 fois dans la liste');
  expect(recs[0]!.evidence.copies.map(c => c.name)).toEqual(['a:docx', 'b:docx', 'docx']);
});

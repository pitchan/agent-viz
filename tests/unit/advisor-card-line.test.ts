// La ligne d'une carte conseil fermee : cout, titre sans le projet, pastille
// de projet, geste en une proposition.
import { expect, test } from 'vitest';
import { splitProjectTitle, projectBadge, gestureHead, compactCost } from '../../src/web/observatory/card-line.ts';
import type { Recommendation } from '../../src/web/observatory/format.ts';

test('le projet accole au titre par le serveur sort du titre', () => {
  expect(splitProjectTitle('Sessions laissant des modifications non vérifiées — projet F:\\DEV\\agent-viz'))
    .toEqual({ headline: 'Sessions laissant des modifications non vérifiées', project: 'F:\\DEV\\agent-viz' });
});

test('un titre sans projet reste entier', () => {
  expect(splitProjectTitle('Skill « docx » présent 2 fois dans la liste'))
    .toEqual({ headline: 'Skill « docx » présent 2 fois dans la liste', project: null });
});

test.each([
  ['F:\\DEV\\agent-viz', 'agent-viz'],
  ['/home/v/projets/site/', 'site'],
  ['F--DEV-AIRBNB-PRECHAC', 'F--DEV-AIRBNB-PRECHAC'],
])('la pastille du projet %s montre « %s »', (projet, pastille) => {
  expect(projectBadge(projet)).toBe(pastille);
});

test.each([
  ['Terminer par la preuve : relancer la commande de test ou de build.', 'Terminer par la preuve'],
  ['Traiter les tâches courtes en direct ; réserver les sous-agents au vrai parallélisme.', 'Traiter les tâches courtes en direct'],
  ['Une description absente vient d’un réglage. Dans le second cas : passer en name-only.', 'Une description absente vient d’un réglage'],
  ['Déplacer le détail (Anthropic conseille un SKILL.md de moins de 500 lignes).',
    'Déplacer le détail (Anthropic conseille un SKILL.md de moins de 500 lignes)'],
])('le geste « %s » se resume a sa premiere proposition', (geste, tete) => {
  expect(gestureHead(geste)).toBe(tete);
});

test('une carte sans geste le dit sur sa ligne', () => {
  expect(gestureHead(null)).toBe('aucun geste — carte informative');
});

const rec = (sur: Partial<Recommendation> = {}): Recommendation => ({
  id: 1, title: 'T', confidence: 'fait', action: null, ruleId: 'R7',
  evidence: { sessions: [], costComplete: true }, estimatedCostUsd: 20.38, costBasis: 'jetons-mesures', ...sur,
});

test.each([
  [rec(), '20,38 $'],
  [rec({ costBasis: 'non-chiffre' }), 'non chiffré'],
  [rec({ evidence: { sessions: [], costComplete: false } }), '≥ 20,38 $'],
])('le cout compact de la carte %# se lit « %s »', (carte, texte) => {
  expect(compactCost(carte)).toBe(texte);
});

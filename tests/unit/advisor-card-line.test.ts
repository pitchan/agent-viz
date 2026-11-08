// La ligne d'une carte conseil fermee : cout, titre sans le projet, pastille
// de projet, geste en une proposition.
import { expect, test } from 'vitest';
import { splitProjectTitle, projectBadge, gestureHead, compactCost } from '../../src/web/observatory/card-line.ts';
import type { Recommendation } from '../../src/web/observatory/format.ts';

test('le projet accole au titre par le serveur sort du titre', () => {
  // Arrange
  const titre = 'Sessions laissant des modifications non vérifiées — projet F:\\DEV\\agent-viz';
  // Act
  const parts = splitProjectTitle(titre);
  // Assert
  expect(parts).toEqual({ headline: 'Sessions laissant des modifications non vérifiées', project: 'F:\\DEV\\agent-viz' });
});

test('un titre sans projet reste entier', () => {
  // Arrange
  const titre = 'Skill « docx » présent 2 fois dans la liste';
  // Act
  const parts = splitProjectTitle(titre);
  // Assert
  expect(parts).toEqual({ headline: 'Skill « docx » présent 2 fois dans la liste', project: null });
});

test.each([
  ['F:\\DEV\\agent-viz', 'agent-viz'],
  ['/home/v/projets/site/', 'site'],
  ['F--DEV-AIRBNB-PRECHAC', 'F--DEV-AIRBNB-PRECHAC'],
])('la pastille du projet %s montre « %s »', (projet, pastille) => {
  // Arrange
  const chemin = projet;
  // Act
  const badge = projectBadge(chemin);
  // Assert
  expect(badge).toBe(pastille);
});

test.each([
  ['Terminer par la preuve : relancer la commande de test ou de build.', 'Terminer par la preuve'],
  ['Traiter les tâches courtes en direct ; réserver les sous-agents au vrai parallélisme.', 'Traiter les tâches courtes en direct'],
  ['Une description absente vient d’un réglage. Dans le second cas : passer en name-only.', 'Une description absente vient d’un réglage'],
  ['Déplacer le détail (Anthropic conseille un SKILL.md de moins de 500 lignes).',
    'Déplacer le détail (Anthropic conseille un SKILL.md de moins de 500 lignes)'],
  ['Ajouter `disable-model-invocation: true` dans son SKILL.md : sa description sort de la liste.',
    'Ajouter `disable-model-invocation: true` dans son SKILL.md'],
  ['Désactiver ce serveur par défaut et ne l’activer que dans les projets qui s’en servent '
    + '(effet non mesuré : action à tester).',
  'Désactiver ce serveur par défaut et ne l’activer que dans les projets qui s’en servent '
    + '(effet non mesuré : action à tester)'],
  ['Relire [la note ; puis la suite] avant de clore', 'Relire [la note ; puis la suite] avant de clore'],
])('le geste « %s » se resume a sa premiere proposition', (geste, tete) => {
  // Arrange
  const action = geste;
  // Act
  const ligne = gestureHead(action);
  // Assert
  expect(ligne).toBe(tete);
});

test('une carte sans geste le dit sur sa ligne', () => {
  // Arrange
  const action = null;
  // Act
  const ligne = gestureHead(action);
  // Assert
  expect(ligne).toBe('aucun geste — carte informative');
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
  // Arrange
  const recommandation = carte;
  // Act
  const cout = compactCost(recommandation);
  // Assert
  expect(cout).toBe(texte);
});

test('sans fin de proposition hors parentheses, un geste trop long est tronque avec « … »', () => {
  // Arrange
  const geste = 'Ouvrir le réglage (puis choisir la valeur qui convient au projet et relancer la session entière';
  // Act
  const tete = gestureHead(geste);
  // Assert
  expect(tete).toBe('Ouvrir le réglage (puis choisir la valeur qui convient au projet et relancer la…');
});

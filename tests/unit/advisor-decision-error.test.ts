// Une décision qui ne s'enregistre pas se dit là où l'on a cliqué : sur une
// carte active comme sur une ligne du journal « Décisions rendues ».
import { expect, test } from 'vitest';
import { fauxElement, parClasse, texte, installFauxDocument } from '../helpers/faux-dom.ts';
import type { Recommendation } from '../../src/web/observatory/format.ts';

installFauxDocument();
const { recommendationCard, showDecisionError } = await import('../../src/web/observatory/advisor-view.ts');
const { renderDecisions } = await import('../../src/web/observatory/decisions-view.ts');

const rec = (sur: Partial<Recommendation> = {}): Recommendation => ({
  id: 7, title: 'Sessions laissant des modifications non vérifiées',
  confidence: 'fait', ruleId: 'R7', evidence: { sessions: [], costComplete: true },
  action: 'Terminer par la preuve : relancer la commande de test ou de build.',
  estimatedCostUsd: 20.38, costBasis: 'jetons-mesures', status: 'new',
  periodFrom: '2026-09-20T00:00:00Z', periodTo: '2026-10-20T00:00:00Z', ...sur,
});

test('un Réactiver refusé affiche la cause sur la ligne du journal', () => {
  // Arrange
  const liste = fauxElement('div');
  renderDecisions(liste, [rec({ status: 'accepted' })]);
  const [ligne] = parClasse(liste, 'advisor-card');
  // Act
  showDecisionError(ligne, 'serveur injoignable');
  // Assert
  const erreurs = parClasse(ligne, 'advisor-card-error');
  expect(erreurs.map(texte)).toEqual(['Décision non enregistrée : serveur injoignable']);
});

test('une réponse refusée ouvre la carte et pose la cause dans son corps, près des boutons', () => {
  // Arrange
  const carte = recommendationCard(rec(), { actionable: true });
  // Act
  showDecisionError(carte, 'serveur injoignable');
  // Assert
  expect(carte.open).toBe(true);
  const [corps] = parClasse(carte, 'advisor-card-body');
  expect(parClasse(corps, 'advisor-card-error').map(texte)).toEqual(['Décision non enregistrée : serveur injoignable']);
});

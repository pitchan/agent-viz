// La carte conseil compacte : une ligne fermee (cout, titre, geste, certitude,
// projet), le detail et les boutons au depliage.
import { expect, test } from 'vitest';
import { fauxElement, parClasse, texte, installFauxDocument } from '../helpers/faux-dom.ts';
import type { Recommendation } from '../../src/web/observatory/format.ts';

installFauxDocument();
const { recommendationCard } = await import('../../src/web/observatory/advisor-view.ts');

const rec = (sur: Partial<Recommendation> = {}): Recommendation => ({
  id: 7, title: 'Sessions laissant des modifications non vérifiées — projet F:\\DEV\\agent-viz',
  confidence: 'fait', ruleId: 'R7', evidence: { sessions: [], costComplete: true },
  action: 'Terminer par la preuve : relancer la commande de test ou de build.',
  estimatedCostUsd: 20.38, costBasis: 'jetons-mesures', status: 'new',
  periodFrom: '2026-09-20T00:00:00Z', periodTo: '2026-10-20T00:00:00Z', ...sur,
});

test('fermee, la carte tient sur une ligne : cout, titre sans projet, geste, certitude, projet', () => {
  // Arrange
  const carte = rec();
  // Act
  const node = recommendationCard(carte, { actionable: true });
  // Assert
  expect(node.tagName).toBe('DETAILS');
  const [ligne] = parClasse(node, 'advisor-card-line');
  expect(ligne.tagName).toBe('SUMMARY');
  expect(texte(parClasse(ligne, 'advisor-card-cost')[0])).toBe('20,38 $');
  expect(texte(parClasse(ligne, 'advisor-card-title')[0])).toBe('Sessions laissant des modifications non vérifiées');
  expect(texte(parClasse(ligne, 'advisor-card-gesture')[0])).toBe('→ Terminer par la preuve');
  expect(texte(parClasse(ligne, 'advisor-card-certainty')[0])).toBe('Fait mesuré');
  const [projet] = parClasse(ligne, 'advisor-card-project');
  expect([texte(projet), projet.title]).toEqual(['agent-viz', 'F:\\DEV\\agent-viz']);
});

test('une carte neuve est fermee ; ouverte, elle garde tout son detail et ses boutons', () => {
  // Arrange
  const carte = rec();
  // Act
  const node = recommendationCard(carte, { actionable: true });
  // Assert
  expect(node.open).toBe(false);
  const [corps] = parClasse(node, 'advisor-card-body');
  expect(texte(parClasse(corps, 'advisor-card-action')[0])).toBe(carte.action);
  expect(texte(parClasse(corps, 'advisor-card-meta')[0])).toBe('Fait mesuré · 20,38 $ — jetons mesurés');
  expect(parClasse(corps, 'advisor-choice').length).toBe(3);
});

test('une carte revenue s ouvre d elle-meme : c est elle qui demande une reponse', () => {
  // Arrange
  const carte = rec({ status: 'accepted', costAtStatusUsd: 10, statusAt: '2026-10-01T10:00:00Z' });
  // Act
  const node = recommendationCard(carte, { actionable: true });
  // Assert
  expect(node.open).toBe(true);
});

test('une carte que l utilisateur a ouverte reste ouverte au rendu suivant', () => {
  // Arrange
  const carte = rec();
  // Act
  const node = recommendationCard(carte, { actionable: true, open: true });
  // Assert
  expect(node.open).toBe(true);
});

test('une carte sans projet ni geste ni cout le dit sur sa ligne, sans pastille de projet', () => {
  // Arrange
  const carte = rec({ title: 'Skill « docx » présent 2 fois dans la liste', action: null, costBasis: 'non-chiffre' });
  // Act
  const node = recommendationCard(carte, { actionable: true });
  // Assert
  const [ligne] = parClasse(node, 'advisor-card-line');
  expect(texte(parClasse(ligne, 'advisor-card-cost')[0])).toBe('non chiffré');
  expect(texte(parClasse(ligne, 'advisor-card-gesture')[0])).toBe('→ aucun geste — carte informative');
  expect(parClasse(ligne, 'advisor-card-project').length).toBe(0);
});

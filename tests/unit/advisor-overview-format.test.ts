// Le haut de la page Conseils : la phrase-bilan, les comptes des
// compteurs-onglets et l'onglet ouvert par defaut. Textes voulus par le
// mainteneur le 20/10/2026.
import { expect, test } from 'vitest';
import { bilanSentence, defaultTab, conseilsCounts, appearancesLabel } from '../../src/web/observatory/overview-format.ts';
import type { Recommendation } from '../../src/web/observatory/format.ts';

const rien = { pannes: { toTreat: 0, top: null }, conseils: 0, revenus: 0 };
const frequente = { name: 'Même appel répété à l’identique', tool: 'Shell (Bash)', count: 11 };

test('une panne apparue 5 fois ou plus est nommee, avec son outil et son compte', () => {
  // Arrange
  const etat = { ...rien, pannes: { toTreat: 13, top: frequente }, conseils: 17 };
  // Act
  const phrase = bilanSentence(etat);
  // Assert
  expect(phrase).toBe('Une panne revient souvent : Même appel répété à l’identique — Shell (Bash) (11 fois). '
    + '17 conseils attendent ta réponse.');
});

test('sous 5 apparitions, la phrase compte les pannes sans en nommer une', () => {
  // Arrange
  const etat = { ...rien, pannes: { toTreat: 13, top: { ...frequente, count: 4 } } };
  // Act
  const phrase = bilanSentence(etat);
  // Assert
  expect(phrase).toBe('13 pannes à traiter, aucune ne revient souvent.');
});

test('une seule panne a traiter s accorde au singulier', () => {
  // Arrange
  const etat = { ...rien, pannes: { toTreat: 1, top: { ...frequente, count: 1 } } };
  // Act
  const phrase = bilanSentence(etat);
  // Assert
  expect(phrase).toBe('1 panne à traiter, aucune ne revient souvent.');
});

test('sans panne a traiter, la phrase le dit puis passe aux conseils', () => {
  // Arrange
  const etat = { ...rien, conseils: 1 };
  // Act
  const phrase = bilanSentence(etat);
  // Assert
  expect(phrase).toBe('Aucune panne à traiter sur la période. 1 conseil attend ta réponse.');
});

test('les conseils revenus se disent sans affirmer qu un geste a ete adopte', () => {
  // Arrange
  const etat = { ...rien, conseils: 3, revenus: 2 };
  // Act
  const phrase = bilanSentence(etat);
  // Assert
  expect(phrase).toBe('Aucune panne à traiter sur la période. 3 conseils attendent ta réponse. '
    + '2 conseils revenus : le problème a regrossi.');
});

test('un seul conseil revenu s accorde au singulier', () => {
  // Arrange
  const etat = { ...rien, conseils: 1, revenus: 1 };
  // Act
  const phrase = bilanSentence(etat);
  // Assert
  expect(phrase).toMatch(/1 conseil revenu : le problème a regrossi\.$/);
});

test('ni panne ni conseil : la phrase reprend le texte de R6', () => {
  expect(bilanSentence(rien)).toBe('Aucune recommandation sur la période — rien à corriger.');
});

test('pannes indisponibles : la phrase ne dit rien des pannes, plutot que d en inventer', () => {
  // Arrange
  const etat = { ...rien, pannes: null, conseils: 2 };
  // Act
  const phrase = bilanSentence(etat);
  // Assert
  expect(phrase).toBe('2 conseils attendent ta réponse.');
});

test.each([[1, 'pannes'], [0, 'conseils']])('%i panne(s) a traiter : l onglet ouvert par defaut est %s', (n, onglet) => {
  expect(defaultTab(n)).toBe(onglet);
});

test.each([[0, ''], [1, 'apparue 1 fois'], [30, 'apparues 30 fois']])('%i apparitions se disent « %s »', (n, texte) => {
  expect(appearancesLabel(n)).toBe(texte);
});

const rec = (sur: Partial<Recommendation> = {}): Recommendation => ({
  id: 1, title: 'T', confidence: 'fait', action: null, ruleId: 'R7', evidence: { sessions: [] },
  estimatedCostUsd: 10, costBasis: 'jetons-mesures', status: 'new', ...sur,
});

test('les conseils a traiter comptent les cartes de tous les blocs ; une carte revenue est aussi comptee a part', () => {
  // Arrange
  const groups = [
    { basis: 'jetons-mesures', priority: [], all: [rec({ id: 1 }), rec({ id: 2, status: 'accepted', costAtStatusUsd: 4 })] },
    { basis: 'non-chiffre', priority: [], all: [rec({ id: 3, costBasis: 'non-chiffre' })] },
  ];
  // Act
  const comptes = conseilsCounts(groups);
  // Assert
  expect(comptes).toEqual({ toTreat: 3, returned: 1 });
});

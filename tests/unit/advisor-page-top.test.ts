// Le haut de la page Conseils une fois câblé : quel onglet s'ouvre, ce qu'il
// cache, ce qu'il garde d'un rendu à l'autre, ce qu'il compte, et la page sans analyse.
import { afterEach, expect, test, vi } from 'vitest';
import { parClasse, texte } from '../helpers/faux-dom.ts';
import { ouvrirLaPage, compteur, finDAnalyse, laPageAFiniDeLire, panne, conseilRevenu } from '../helpers/page-conseils.ts';

afterEach(() => { vi.unstubAllGlobals(); });

test('une panne a traiter : l onglet Pannes s ouvre, son compteur est souligne, Conseils est cache', async () => {
  // Arrange
  const serveur = { alertes: [panne] };
  // Act
  const page = await ouvrirLaPage(serveur);
  // Assert
  expect(page.noeud('advisor-tab-pannes').hidden).toBe(false);
  expect(page.noeud('advisor-tab-conseils').hidden).toBe(true);
  expect(compteur(page, 'pannes à traiter').classList.contains('is-active')).toBe(true);
});

test('aucune panne a traiter : l onglet Conseils s ouvre, Pannes est cache', async () => {
  // Arrange
  const serveur = { alertes: [] };
  // Act
  const page = await ouvrirLaPage(serveur);
  // Assert
  expect(page.noeud('advisor-tab-conseils').hidden).toBe(false);
  expect(page.noeud('advisor-tab-pannes').hidden).toBe(true);
});

test('l onglet choisi reste ouvert quand la fin d une analyse redessine la page', async () => {
  // Arrange
  const page = await ouvrirLaPage({ alertes: [panne] });
  compteur(page, 'conseils à traiter').click();
  // Act
  await finDAnalyse(page);
  // Assert
  expect(page.noeud('advisor-tab-conseils').hidden).toBe(false);
  expect(page.noeud('advisor-tab-pannes').hidden).toBe(true);
});

test('l onglet choisi reste ouvert quand on change de periode', async () => {
  // Arrange
  const page = await ouvrirLaPage({ alertes: [panne] });
  compteur(page, 'conseils à traiter').click();
  const sept = page.noeud('advisor-period').children.find((b: any) => texte(b) === '7 j');
  // Act
  sept.click();
  await laPageAFiniDeLire();
  // Assert
  expect(page.noeud('advisor-tab-conseils').hidden).toBe(false);
  expect(page.noeud('advisor-tab-pannes').hidden).toBe(true);
});

test('a l ouverture, le detail de la periode est replie', async () => {
  // Arrange
  const serveur = { alertes: [] };
  // Act
  const page = await ouvrirLaPage(serveur);
  // Assert
  const [detail] = parClasse(page.noeud('advisor-summary'), 'advisor-period-details');
  expect(detail.tagName).toBe('DETAILS');
  expect(detail.open).toBe(false);
});

test('analyse indisponible : la page le dit, sans phrase-bilan ni compteurs, et Pannes reste visible', async () => {
  // Arrange
  const serveur = { alertes: [panne], analyse: 'en panne' as const };
  // Act
  const page = await ouvrirLaPage(serveur);
  // Assert
  expect(texte(page.noeud('advisor-summary'))).toBe('Analyse indisponible : base illisible');
  expect(texte(page.noeud('advisor-bilan'))).toBe('');
  expect(page.noeud('advisor-tabs').children.length).toBe(0);
  expect(page.noeud('advisor-tab-pannes').hidden).toBe(false);
  expect(page.noeud('advisor-tab-conseils').hidden).toBe(true);
});

test('une carte revenue rangee sous « Ne se produit plus » compte dans les conseils revenus', async () => {
  // Arrange
  const serveur = { conseils: { stale: [conseilRevenu()] } };
  // Act
  const page = await ouvrirLaPage(serveur);
  // Assert
  expect(texte(parClasse(compteur(page, 'conseils revenus'), 'advisor-counter-n')[0])).toBe('1');
  expect(texte(page.noeud('advisor-bilan'))).toContain('1 conseil revenu');
});

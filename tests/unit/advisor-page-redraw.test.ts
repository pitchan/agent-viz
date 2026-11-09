// Ce qu'un nouveau rendu de la page Conseils garde tel que l'utilisateur l'a
// laissé : une carte revenue refermée, la section « Décisions rendues » ouverte.
import { afterEach, expect, test, vi } from 'vitest';
import { parClasse, texte } from '../helpers/faux-dom.ts';
import { ouvrirLaPage, finDAnalyse, laPageAFiniDeLire, conseil, conseilRevenu } from '../helpers/page-conseils.ts';

afterEach(() => { vi.unstubAllGlobals(); });

const carteDe = (page: Awaited<ReturnType<typeof ouvrirLaPage>>) =>
  parClasse(page.noeud('advisor-list'), 'advisor-card')[0];

test('une carte revenue refermee reste fermee quand la fin d une analyse redessine la page', async () => {
  // Arrange
  const revenue = conseilRevenu();
  const page = await ouvrirLaPage({ conseils: { groups: [{ basis: 'jetons-mesures', priority: [revenue], all: [revenue] }] } });
  const carte = carteDe(page);
  carte.open = false;
  carte.handlers.toggle();
  // Act
  await finDAnalyse(page);
  // Assert
  expect(carteDe(page).open).toBe(false);
});

test('un Reactiver refuse laisse ouverte la section Decisions rendues et y montre la cause', async () => {
  // Arrange
  const page = await ouvrirLaPage({ conseils: { decided: [conseil({ status: 'accepted', statusAt: '2026-10-01T00:00:00Z' })] }, decision: 'refusee' });
  const [section] = parClasse(page.noeud('advisor-list'), 'advisor-decisions');
  section.open = true;
  section.handlers.toggle();
  const reactiver = parClasse(section, 'obs-btn').find((b: any) => texte(b) === 'Réactiver');
  // Act
  page.noeud('advisor-list').handlers.click({ target: reactiver });
  await laPageAFiniDeLire();
  // Assert
  const [apres] = parClasse(page.noeud('advisor-list'), 'advisor-decisions');
  expect(apres.open).toBe(true);
  expect(parClasse(apres, 'advisor-card-error').map(texte)).toEqual(['Décision non enregistrée : serveur injoignable']);
});

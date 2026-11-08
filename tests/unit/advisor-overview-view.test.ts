// Le haut de la page Conseils : la phrase-bilan et les trois compteurs, qui
// servent d'onglets.
import { expect, test } from 'vitest';
import { fauxElement, parClasse, texte, installFauxDocument } from '../helpers/faux-dom.ts';
import { renderOverview } from '../../src/web/observatory/overview-view.ts';
import { layoutPannes } from '../../src/web/observatory/failures-tools.ts';
import type { Alert } from '../../src/engine/watchdog/detector.ts';

installFauxDocument();

const T0 = Date.UTC(2026, 9, 19, 20, 0, 0);
const alerte = (sur: Record<string, any> = {}): Alert => ({
  id: 'x', type: 'loop', sessionId: 's1', toolName: 'Bash', count: 4, createdAt: T0,
  message: '', agentId: '', agentType: '', subject: 'git status', occurrences: [], tools: [],
  cwd: 'F:\\DEV\\agent-viz', standing: false, patternId: '', acknowledged: false, ...sur,
} as Alert);
const boucles = Array.from({ length: 6 }, (_, i) => alerte({ id: `l${i}`, createdAt: T0 - i }));
const stuck = alerte({ id: 's', type: 'stuck', toolName: '', standing: true });

const donnees = (sur: Record<string, any> = {}) => ({
  layout: layoutPannes([...boucles, stuck]),
  conseils: { toTreat: 17, returned: 0 },
  ...sur,
});

const rendre = (data = donnees(), active: 'pannes' | 'conseils' = 'pannes', onSelect = (_t: string) => {}) => {
  const bilan = fauxElement('div');
  const onglets = fauxElement('div');
  renderOverview(bilan, onglets, data, active, onSelect);
  return { bilan, onglets };
};

test('la phrase-bilan nomme la panne frequente et compte les conseils', () => {
  // Arrange
  const data = donnees();
  // Act
  const { bilan } = rendre(data);
  // Assert
  expect(texte(bilan)).toBe('Une panne revient souvent : Même appel répété à l’identique — Shell (Bash) (6 fois). '
    + '17 conseils attendent ta réponse.');
});

test('trois compteurs : pannes avec leurs apparitions, conseils, conseils revenus — les stuck n y comptent pas', () => {
  // Arrange
  const data = donnees({ conseils: { toTreat: 17, returned: 2 } });
  // Act
  const { onglets } = rendre(data);
  // Assert
  const compteurs = parClasse(onglets, 'advisor-counter');
  expect(compteurs.map(c => texte(parClasse(c, 'advisor-counter-n')[0]))).toEqual(['1', '17', '2']);
  expect(texte(parClasse(compteurs[0], 'advisor-counter-label')[0])).toBe('pannes à traiter · apparues 6 fois');
  expect(texte(parClasse(compteurs[1], 'advisor-counter-label')[0])).toBe('conseils à traiter');
  expect(texte(parClasse(compteurs[2], 'advisor-counter-label')[0])).toBe('conseils revenus');
});

test('le compteur de l onglet ouvert est marque actif', () => {
  // Arrange
  const data = donnees();
  // Act
  const { onglets } = rendre(data, 'conseils');
  // Assert
  const compteurs = parClasse(onglets, 'advisor-counter');
  expect(compteurs.map(c => c.classList.contains('is-active'))).toEqual([false, true, false]);
  expect(compteurs[1].attrs['aria-selected']).toBe('true');
});

test.each([[0, 'pannes'], [1, 'conseils'], [2, 'conseils']])('le compteur %i ouvre l onglet %s', (i, onglet) => {
  // Arrange
  const choisis: string[] = [];
  const { onglets } = rendre(donnees(), 'pannes', t => choisis.push(t));
  // Act
  parClasse(onglets, 'advisor-counter')[i].click();
  // Assert
  expect(choisis).toEqual([onglet]);
});

test('pannes indisponibles : le compteur le dit, la phrase-bilan n en parle pas', () => {
  // Arrange
  const data = donnees({ layout: null });
  // Act
  const { bilan, onglets } = rendre(data);
  // Assert
  const [pannes] = parClasse(onglets, 'advisor-counter');
  expect(texte(parClasse(pannes, 'advisor-counter-n')[0])).toBe('—');
  expect(texte(parClasse(pannes, 'advisor-counter-label')[0])).toBe('pannes indisponibles');
  expect(texte(bilan)).toBe('17 conseils attendent ta réponse.');
});

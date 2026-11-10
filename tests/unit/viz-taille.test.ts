// La toile du graphe se recalcule à chaque changement de taille de #main, y
// compris quand la fenêtre, elle, garde sa taille (bande du narrateur qui
// apparaît ou disparaît).

import { expect, test } from 'vitest';
import { suivreTaille, type SourcesDeTaille } from '../../src/web/viz-taille.ts';

function sourcesFactices() {
  const rappelsFenetre: Array<() => void> = [];
  const observes: Array<{ element: Element; rappel: () => void }> = [];
  const sources: SourcesDeTaille = {
    fenetre: { addEventListener: (_type, rappel) => { rappelsFenetre.push(rappel); } },
    creerObservateur: rappel => ({ observe: element => { observes.push({ element, rappel }); } }),
  };
  return {
    sources,
    redimensionnerFenetre: () => rappelsFenetre.forEach(r => r()),
    changerTaille: (element: Element) =>
      observes.filter(o => o.element === element).forEach(o => o.rappel()),
  };
}

test('un changement de taille de l\'élément suivi, fenêtre immobile, relance le calcul', () => {
  // Arrange
  const element = {} as Element;
  const faux = sourcesFactices();
  let appels = 0;
  suivreTaille(element, () => { appels++; }, faux.sources);

  // Act
  faux.changerTaille(element);

  // Assert
  expect(appels).toBe(1);
});

test('un redimensionnement de la fenêtre relance le calcul', () => {
  // Arrange
  const faux = sourcesFactices();
  let appels = 0;
  suivreTaille({} as Element, () => { appels++; }, faux.sources);

  // Act
  faux.redimensionnerFenetre();

  // Assert
  expect(appels).toBe(1);
});

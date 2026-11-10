// La toile du graphe reprend la taille de #main quand #main change de taille
// alors que la fenêtre ne bouge pas (bande du narrateur qui apparaît ou
// disparaît). viz-canvas.ts lit le navigateur dès son import : le test le lui fournit.

import { expect, test, vi } from 'vitest';

// Un contexte 2D dont chaque méthode ne fait rien : seul le dimensionnement compte ici.
const faux2d = () => new Proxy({}, { get: () => () => {} });
const fausseToile = () => ({
  width: 0, height: 0, style: {} as Record<string, string>,
  getContext: faux2d, addEventListener() {},
});

function installerNavigateur() {
  const main = { clientWidth: 1280, clientHeight: 852 };
  const toile = fausseToile();
  const elements: Record<string, unknown> = { canvas: toile, main, 'node-tooltip': {} };
  const observateurs: Array<{ rappel: ResizeObserverCallback; observes: unknown[] }> = [];
  vi.stubGlobal('document', { getElementById: (id: string) => elements[id], createElement: fausseToile });
  vi.stubGlobal('window', { addEventListener() {} });
  vi.stubGlobal('devicePixelRatio', 1);
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('ResizeObserver', class {
    observes: unknown[] = [];
    constructor(rappel: ResizeObserverCallback) { observateurs.push({ rappel, observes: this.observes }); }
    observe(element: unknown) { this.observes.push(element); }
  });
  const changerTaille = (element: unknown) => observateurs
    .filter(o => o.observes.includes(element))
    .forEach(o => o.rappel([{ target: element } as unknown as ResizeObserverEntry], {} as ResizeObserver));
  return { main, toile, changerTaille };
}

// Chargé hors du test : la transformation du module dépasse la seconde.
const nav = installerNavigateur();
await import('../../src/web/viz-canvas.ts');

test('la toile prend la nouvelle hauteur de #main, fenêtre immobile', () => {
  // Arrange
  nav.main.clientHeight = 824;

  // Act
  nav.changerTaille(nav.main);

  // Assert
  expect(nav.toile.style.height).toBe('824px');
});

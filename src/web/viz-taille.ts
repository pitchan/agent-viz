// viz-taille.ts — prévient quand la taille d'affichage d'un élément peut avoir changé.
//
// La fenêtre et la fabrique d'observateur sont passées en paramètre : le module
// ne touche aucun global du navigateur, et se teste sous Node.

export interface SourcesDeTaille {
  fenetre: { addEventListener(type: 'resize', rappel: () => void): void };
  creerObservateur: (rappel: () => void) => { observe(element: Element): void };
}

export function suivreTaille(element: Element, rappel: () => void, sources: SourcesDeTaille): void {
  sources.creerObservateur(rappel).observe(element);
  // L'observateur compte en pixels CSS : il ne voit pas la densité de pixels qui
  // change quand la fenêtre passe sur un écran d'une autre échelle.
  sources.fenetre.addEventListener('resize', rappel);
}

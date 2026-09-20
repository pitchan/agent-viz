// La carte de conseil : trois intentions dans les mots de
// l'utilisateur, leur conséquence écrite sous chaque bouton, et le bandeau
// d'une carte décidée qui re-surface. Faux document, comme decisions-view.
import { expect, test } from 'vitest';

function fauxElement(tag: string): any {
  const classes = new Set<string>();
  return {
    tagName: tag.toUpperCase(),
    children: [] as any[],
    handlers: {} as Record<string, any>,
    dataset: {} as Record<string, any>,
    attrs: {} as Record<string, any>,
    value: '',
    type: '',
    _text: '',
    get textContent() { return this._text; },
    set textContent(v: string) { this._text = v; this.children.length = 0; },
    set className(v: string) { classes.clear(); for (const c of v.split(/\s+/)) if (c) classes.add(c); },
    get className() { return [...classes].join(' '); },
    classList: {
      add: (c: string) => classes.add(c), remove: (c: string) => classes.delete(c),
      toggle: (c: string) => (classes.has(c) ? classes.delete(c) : classes.add(c)),
      contains: (c: string) => classes.has(c),
    },
    setAttribute(k: string, v: any) { this.attrs[k] = v; },
    append(...nodes: any[]) { this.children.push(...nodes); },
    appendChild(n: any) { this.children.push(n); return n; },
    addEventListener(evt: string, fn: (...a: any[]) => void) { this.handlers[evt] = fn; },
    click() { this.handlers.click && this.handlers.click({ target: this }); },
  };
}

const aPlat = (n: any): any[] => [n, ...n.children.flatMap(aPlat)];
const parClasse = (racine: any, classe: string) =>
  aPlat(racine).filter(n => n.classList && n.classList.contains(classe));

globalThis.document = { createElement: fauxElement } as unknown as Document;

const { recommendationCard } = await import('../../src/web/observatory/advisor-view.ts');

// Une carte minimale : une règle inconnue de la table d'évidences pour ne
// tester que la carte, pas les phrases de mesure.
const carte = (sur: Record<string, any> = {}) => ({
  id: 5, ruleId: 'RX', title: 'titre', confidence: 'fait',
  estimatedCostUsd: 10, costBasis: 'jetons-mesures',
  evidence: { sessions: [] }, action: 'brancher les MCP avant la session',
  status: 'new', costAtStatusUsd: null, statusReason: null, statusAt: null,
  periodFrom: '2026-07-01T00:00:00.000Z', periodTo: '2026-07-15T00:00:00.000Z',
  ...sur,
});

test('trois intentions, dans cet ordre, chacune avec sa conséquence écrite dessous', () => {
  // Arrange + Act
  const node = recommendationCard(carte(), { actionable: true });
  // Assert — les choix sont des colonnes bouton + légende.
  const choix = parClasse(node, 'advisor-choice');
  expect(choix.length).toBe(3);
  const boutons = choix.map(c => parClasse(c, 'obs-btn')[0]);
  expect(boutons.map(b => b.textContent)).toEqual(['Je l’adopte', 'Plus tard', 'Non merci']);
  expect(boutons.slice(0, 2).map(b => b.dataset.status)).toEqual(['accepted', 'ignored']);
  const legendes = choix.map(c => parClasse(c, 'advisor-choice-caption')[0].textContent);
  expect(legendes).toEqual([
    'La carte part au journal. Si le coût regrossit malgré tout, elle reviendra te demander si le geste a vraiment pris.',
    'Revient d’elle-même si le coût regrossit de moitié.',
    'Dis pourquoi en une ligne ; c’est consigné au journal et ne sera plus proposé.',
  ]);
});

test('une carte informative ne propose pas « Je l’adopte » — rien à adopter', () => {
  // Arrange + Act
  const node = recommendationCard(carte({ action: null }), { actionable: true });
  // Assert
  const libelles = parClasse(node, 'advisor-choice')
    .map(c => parClasse(c, 'obs-btn')[0].textContent);
  expect(libelles).toEqual(['Plus tard', 'Non merci']);
});

test('une adoption revenue porte son bandeau : le coût a regrossi, le geste a-t-il pris ?', () => {
  // Arrange + Act
  const node = recommendationCard(carte({
    status: 'accepted', costAtStatusUsd: 10, estimatedCostUsd: 16,
    statusAt: '2026-07-10T00:00:00.000Z',
  }), { actionable: true });
  // Assert
  expect(parClasse(node, 'advisor-card-return')[0].textContent).toBe(
    'Adopté le 10/07/2026 — le coût a pourtant regrossi de 60 % depuis. Le geste a-t-il pris ?');
});

test('une carte neuve n’a pas de bandeau de retour', () => {
  // Arrange + Act
  const node = recommendationCard(carte(), { actionable: true });
  // Assert
  expect(parClasse(node, 'advisor-card-return').length).toBe(0);
});

test('une carte non actionnable (« ne se produit plus ») n’a aucun bouton', () => {
  // Arrange + Act
  const node = recommendationCard(carte(), { actionable: false });
  // Assert
  expect(parClasse(node, 'obs-btn').length).toBe(0);
});

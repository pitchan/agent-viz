// La section « Décisions rendues » (le journal) et le contrôle
// « Non merci » d'une carte active, testés sur un faux document — même parti
// que failures-view.test.ts : pas de navigateur, pas de jsdom.
import { expect, test } from 'vitest';
import { renderDecisions, refusalControls } from '../../src/web/observatory/decisions-view.ts';

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

// Tous les noeuds de l'arbre, à plat — les assertions cherchent par classe.
const aPlat = (n: any): any[] => [n, ...n.children.flatMap(aPlat)];
const parClasse = (racine: any, classe: string) =>
  aPlat(racine).filter(n => n.classList && n.classList.contains(classe));
const parBalise = (racine: any, balise: string) => aPlat(racine).filter(n => n.tagName === balise);

globalThis.document = { createElement: fauxElement } as unknown as Document;

const recDecide = (id: number, sur: Record<string, any> = {}) => ({
  id, title: `titre ${id}`, status: 'arbitrated', statusAt: '2026-07-10T12:00:00.000Z',
  statusReason: 'tests vérifiés au terminal', ...sur,
});

test('la section est un accordéon replié qui annonce son compte', () => {
  // Arrange
  const node = fauxElement('div');
  // Act
  renderDecisions(node, [recDecide(1), recDecide(2)]);
  // Assert
  const [section] = parClasse(node, 'advisor-decisions');
  expect(section.tagName, 'accordéon natif, replié par défaut').toBe('DETAILS');
  expect(section.attrs.open, 'jamais déplié d’office').toBe(undefined);
  const [resume] = parBalise(section, 'SUMMARY');
  expect(resume.textContent).toBe('Décisions rendues (2)');
});

test('un refus au journal montre la raison, la date, et un Réactiver d’un clic', () => {
  // Arrange
  const node = fauxElement('div');
  // Act
  renderDecisions(node, [recDecide(7)]);
  // Assert
  const [carte] = parClasse(node, 'advisor-card');
  expect(carte.dataset.recId, 'la délégation de clic existante retrouve la carte').toBe('7');
  expect(parClasse(carte, 'advisor-card-title')[0].textContent).toBe('titre 7');
  expect(parClasse(carte, 'advisor-card-decision')[0].textContent)
    .toMatch(/^Refusé le 10\/07\/2026 — tests vérifiés au terminal$/);
  const [btn] = parClasse(carte, 'obs-btn');
  expect(btn.textContent).toBe('Réactiver');
  expect(btn.dataset.status, 'la réactivation passe par le rail de statut existant').toBe('new');
});

test('une adoption au journal annonce sa surveillance dans les mots de l’utilisateur', () => {
  // Arrange
  const node = fauxElement('div');
  // Act
  renderDecisions(node, [recDecide(3, { status: 'accepted', statusReason: null })]);
  // Assert
  expect(parClasse(node, 'advisor-card-decision')[0].textContent).toBe(
    'Adopté le 10/07/2026 — reviendra si le coût regrossit malgré tout');
});

test('sans décision rendue, aucune section — pas de tiroir vide', () => {
  // Arrange
  const node = fauxElement('div');
  // Act
  renderDecisions(node, []);
  // Assert
  expect(node.children.length).toBe(0);
});

test('le champ raison ne se montre qu’après « Non merci »', () => {
  // Arrange
  const wrap = refusalControls(() => {});
  // Act
  const [toggle] = parClasse(wrap, 'obs-btn').filter(b => b.textContent === 'Non merci');
  toggle.click();
  // Assert
  expect(wrap.classList.contains('armed')).toBe(true);
  const [champ] = parClasse(wrap, 'advisor-refuse-reason');
  expect(champ.attrs.placeholder).toBe('Pourquoi ? (une ligne)');
});

test('Consigner sans raison ne consigne rien', () => {
  // Arrange
  let recu: string | null = null;
  const wrap = refusalControls(raison => { recu = raison; });
  const [consigner] = parClasse(wrap, 'obs-btn').filter(b => b.textContent === 'Consigner');
  parClasse(wrap, 'advisor-refuse-reason')[0].value = '   ';
  // Act
  consigner.click();
  // Assert
  expect(recu, 'une raison blanche ne part jamais au serveur').toBe(null);
});

test('Consigner porte la raison, débarrassée de ses blancs', () => {
  // Arrange
  let recu: string | null = null;
  const wrap = refusalControls(raison => { recu = raison; });
  const [consigner] = parClasse(wrap, 'obs-btn').filter(b => b.textContent === 'Consigner');
  parClasse(wrap, 'advisor-refuse-reason')[0].value = '  déjà pesé au boulot  ';
  // Act
  consigner.click();
  // Assert
  expect(recu).toBe('déjà pesé au boulot');
});

test('le bouton Consigner ne porte pas de data-status — la délégation ne doit pas le voir', () => {
  // Arrange
  const wrap = refusalControls(() => {});
  // Act
  const boutons = parClasse(wrap, 'obs-btn');
  // Assert
  for (const b of boutons) expect(b.dataset.status).toBe(undefined);
});

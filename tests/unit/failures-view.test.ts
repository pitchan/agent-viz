// La vue accordeon, testee sur un faux document — meme parti que le stub de
// observatory-confirm-button.test.ts : pas de navigateur, pas de jsdom.
import { expect, test } from 'vitest';
import { renderFailures } from '../../src/web/observatory/failures-view.ts';
import type { Alert } from '../../src/engine/watchdog/detector.ts';

function fauxElement(tag: string): any {
  const classes = new Set<string>();
  return {
    tagName: tag.toUpperCase(),
    children: [] as any[],
    handlers: {} as Record<string, any>,
    dataset: {} as Record<string, any>,
    attrs: {} as Record<string, any>,
    disabled: false,
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

// Tous les noeuds de l arbre, a plat — les assertions cherchent par classe.
const aPlat = (n: any): any[] => [n, ...n.children.flatMap(aPlat)];
const parClasse = (racine: any, classe: string) =>
  aPlat(racine).filter(n => n.classList && n.classList.contains(classe));

globalThis.document = { createElement: fauxElement } as unknown as Document;

const T0 = Date.UTC(2026, 7, 8, 20, 1, 0);
const invocation = (sur: Record<string, any> = {}) => ({
  type: 'badInvocation', toolName: 'Bash', count: 1, createdAt: T0,
  patternId: 'inv-bash-trailing-backslash-in-path', subject: 'ls "F:\\DEV\\public\\"',
  cwd: 'f:\\DEV\\demo', acknowledged: false, occurrences: [], tools: [], ...sur,
} as unknown as Alert);

test('une cause, une ligne : les episodes vivent dans le depliage', () => {
  const node = fauxElement('div');
  renderFailures(node, [invocation(), invocation({ createdAt: T0 - 60_000 })]);
  const groupes = parClasse(node, 'failure-group');
  expect(groupes.length).toBe(1);
  expect(groupes[0].tagName, 'accordeon natif, accessible clavier').toBe('DETAILS');
  const cause = parClasse(node, 'failure-cause')[0];
  expect(cause.textContent).toMatch(/guillemet double non fermé/);
  expect(parClasse(node, 'failure-episode').length).toBe(2);
});

test('l episode montre la commande en defaut ; sans commande consignee, il le dit', () => {
  const node = fauxElement('div');
  renderFailures(node, [invocation(), invocation({ subject: '', createdAt: T0 - 1000 })]);
  const cmds = parClasse(node, 'failure-cmd');
  expect(cmds[0].textContent).toBe('ls "F:\\DEV\\public\\"');
  expect(cmds[1].textContent).toBe('commande non consignée (alerte ancienne)');
});

// Le bloc est la memoire des FAUTES : `stuck`, etat passager qui se resout tout
// seul, y noyait les vraies pannes. Sa place vivante est la pastille et la
// notification bureau, qui nomment chaque commande en vol.
const stuck = (sur: Record<string, any> = {}) => invocation({
  type: 'stuck', toolName: '', patternId: '', subject: '', count: 2, standing: true,
  tools: [{ toolName: 'Bash', subject: 'npm run build' }, { toolName: 'Read', subject: 'a.js' }],
  ...sur,
});

test('une alerte stuck ne s affiche pas : le bloc ne montre que des fautes', () => {
  const node = fauxElement('div');
  renderFailures(node, [invocation(), stuck()]);
  expect(parClasse(node, 'failure-group').length, 'la faute reste, le silence non').toBe(1);
  expect(parClasse(node, 'failure-cause')[0].textContent.includes('en vol')).toBe(false);
});

test('le compteur du bloc ignore les stuck non acquittes', () => {
  const node = fauxElement('div');
  renderFailures(node, [invocation(), stuck()]);
  expect(parClasse(node, 'failures-count')[0].textContent).toBe('1 non acquittée');
});

test('rien que des stuck = le bloc dit « aucune panne », pas un bloc vide', () => {
  const node = fauxElement('div');
  renderFailures(node, [stuck(), stuck({ createdAt: T0 - 1000 })]);
  expect(parClasse(node, 'failure-group').length).toBe(0);
  expect(parClasse(node, 'failures-count')[0].textContent).toBe('aucune');
  expect(parClasse(node, 'failures-empty').length,
    'un bloc vide sans un mot serait indiscernable d un bug du panneau').toBe(1);
});

// Une ligne du journal hors forme est ecartee a l'entree du navigateur : elle
// n'est dans aucun compte du bloc, qui dit combien il en a laisse de cote.
test('la ligne des illisibles ne s affiche que s il y en a, avec son compte accorde', () => {
  // Arrange
  const comptes = [0, 1, 3];
  // Act
  const [sans, une, trois] = comptes.map(rejetees => {
    const node = fauxElement('div');
    renderFailures(node, [invocation()], { rejetees });
    return node;
  });
  // Assert
  expect(parClasse(sans, 'failures-illisibles').length, 'aucune ligne ecartee, rien a dire').toBe(0);
  expect(parClasse(une, 'failures-illisibles')[0].textContent).toBe('1 ligne du journal illisible, non comptée');
  expect(parClasse(trois, 'failures-illisibles')[0].textContent).toBe('3 lignes du journal illisibles, non comptées');
  expect(parClasse(trois, 'failure-group').length, 'le reste du bloc se rend normalement').toBe(1);
});

test('le remede s affiche avec son extrait ; le filet n en a pas', () => {
  const node = fauxElement('div');
  renderFailures(node, [invocation()]);
  expect(parClasse(node, 'failure-remede').length).toBe(1);
  expect(parClasse(node, 'remede-extrait')[0].textContent).toMatch(/antislash final/);
  const zone = parClasse(node, 'remede-copie')[0];
  expect(zone.attrs['aria-live']).toBe('polite');

  const filet = fauxElement('div');
  renderFailures(filet, [invocation({ patternId: 'inv-bash-unbalanced-quote' })]);
  expect(parClasse(filet, 'failure-remede').length, 'jamais de conseil invente').toBe(0);
});

test('« Tout acquitter » n existe que s il reste a traiter, et emet l intention', () => {
  const node = fauxElement('div');
  const recus: any[] = [];
  const episodes = [invocation(), invocation({ acknowledged: true, createdAt: T0 - 1000 })];
  renderFailures(node, episodes, { onAckGroup: eps => { recus.push(eps); return Promise.resolve(); } });
  const [btn] = parClasse(node, 'failure-ack');
  expect(btn.textContent).toMatch(/Tout acquitter \(1\)/);
  btn.click();
  expect(btn.disabled, 'desactive pendant l operation').toBe(true);
  expect(recus[0].length, 'l intention porte les episodes du groupe, l orchestrateur filtre').toBe(2);

  const solde = fauxElement('div');
  renderFailures(solde, [invocation({ acknowledged: true })], { onAckGroup: () => {} });
  expect(parClasse(solde, 'failure-ack').length).toBe(0);
  expect(parClasse(solde, 'failure-group')[0].classList.contains('is-acked')).toBeTruthy();
});

test('sans onAckGroup la vue reste muette cote reseau : aucun bouton d acquittement', () => {
  const node = fauxElement('div');
  renderFailures(node, [invocation()]);
  expect(parClasse(node, 'failure-ack').length).toBe(0);
});

// Une commande tronquee se deplie aussi au clavier : role, tabindex et annonce de
// l etat (WCAG 2.1.1 et 4.1.2). La ligne « non consignee » n a rien a deplier : elle
// reste du texte inerte, pas un faux bouton qui ment a la synthese vocale.
test('la commande tronquee se deplie au clavier et annonce son etat', () => {
  const node = fauxElement('div');
  renderFailures(node, [invocation(), invocation({ subject: '', createdAt: T0 - 1000 })]);
  const [cmd, absente] = parClasse(node, 'failure-cmd');

  expect(cmd.attrs.role).toBe('button');
  expect(cmd.attrs.tabindex).toBe('0');
  expect(cmd.attrs['aria-expanded']).toBe('false');
  cmd.handlers.keydown({ key: 'Enter', preventDefault() {} });
  expect(cmd.classList.contains('is-open')).toBeTruthy();
  expect(cmd.attrs['aria-expanded']).toBe('true');

  expect(absente.attrs.role, 'rien a deplier, donc pas un bouton').toBe(undefined);
  expect(absente.handlers.click).toBe(undefined);
});

// Un seul systeme de boutons pour le produit : la vue porte la classe commune
// au lieu de redecrire un look. Sans elle, le bouton retombe sur le bouton
// natif de l OS — gris clair sur panneau sombre, 1,3:1 de contraste.
test('tout bouton de la vue porte la classe du systeme de boutons', () => {
  const node = fauxElement('div');
  renderFailures(node, [invocation()], { onAckGroup: () => {} });
  const boutons = aPlat(node).filter(n => n.tagName === 'BUTTON');
  expect(boutons.length >= 2, 'au moins Copier et Tout acquitter').toBeTruthy();
  for (const b of boutons) {
    expect(b.classList.contains('obs-btn'), `bouton sans style commun : ${b.textContent}`).toBeTruthy();
  }
});

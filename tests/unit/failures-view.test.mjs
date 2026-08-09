// La vue accordeon, testee sur un faux document — meme parti que le stub de
// observatory-confirm-button.test.mjs : pas de navigateur, pas de jsdom.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderFailures } from '../../public/observatory/failures-view.js';

function fauxElement(tag) {
  const classes = new Set();
  return {
    tagName: tag.toUpperCase(),
    children: [],
    handlers: {},
    dataset: {},
    attrs: {},
    disabled: false,
    _text: '',
    get textContent() { return this._text; },
    set textContent(v) { this._text = v; this.children.length = 0; },
    set className(v) { classes.clear(); for (const c of v.split(/\s+/)) if (c) classes.add(c); },
    get className() { return [...classes].join(' '); },
    classList: {
      add: c => classes.add(c), remove: c => classes.delete(c),
      toggle: c => (classes.has(c) ? classes.delete(c) : classes.add(c)),
      contains: c => classes.has(c),
    },
    setAttribute(k, v) { this.attrs[k] = v; },
    append(...nodes) { this.children.push(...nodes); },
    appendChild(n) { this.children.push(n); return n; },
    addEventListener(evt, fn) { this.handlers[evt] = fn; },
    click() { this.handlers.click && this.handlers.click({ target: this }); },
  };
}

// Tous les noeuds de l arbre, a plat — les assertions cherchent par classe.
const aPlat = n => [n, ...n.children.flatMap(aPlat)];
const parClasse = (racine, classe) =>
  aPlat(racine).filter(n => n.classList && n.classList.contains(classe));

globalThis.document = { createElement: fauxElement };

const T0 = Date.UTC(2026, 7, 8, 20, 1, 0);
const invocation = (sur = {}) => ({
  type: 'badInvocation', toolName: 'Bash', count: 1, createdAt: T0,
  patternId: 'inv-bash-trailing-backslash-in-path', subject: 'ls "F:\\DEV\\public\\"',
  cwd: 'f:\\DEV\\demo', acknowledged: false, occurrences: [], tools: [], ...sur,
});

test('une cause, une ligne : les episodes vivent dans le depliage', () => {
  const node = fauxElement('div');
  renderFailures(node, [invocation(), invocation({ createdAt: T0 - 60_000 })]);
  const groupes = parClasse(node, 'failure-group');
  assert.equal(groupes.length, 1);
  assert.equal(groupes[0].tagName, 'DETAILS', 'accordeon natif, accessible clavier');
  const cause = parClasse(node, 'failure-cause')[0];
  assert.match(cause.textContent, /guillemet double non fermé/);
  assert.equal(parClasse(node, 'failure-episode').length, 2);
});

test('l episode montre la commande en defaut ; sans commande consignee, il le dit', () => {
  const node = fauxElement('div');
  renderFailures(node, [invocation(), invocation({ subject: '', createdAt: T0 - 1000 })]);
  const cmds = parClasse(node, 'failure-cmd');
  assert.equal(cmds[0].textContent, 'ls "F:\\DEV\\public\\"');
  assert.equal(cmds[1].textContent, 'commande non consignée (alerte ancienne)');
});

test('une alerte stuck liste TOUS ses outils en vol', () => {
  const node = fauxElement('div');
  renderFailures(node, [invocation({
    type: 'stuck', toolName: '', patternId: '', subject: '', count: 2,
    tools: [{ toolName: 'Bash', subject: 'npm run build' }, { toolName: 'Read', subject: 'a.js' },
      { toolName: 'AskUserQuestion', subject: '' }],
  })]);
  const cmds = parClasse(node, 'failure-cmd');
  assert.equal(cmds.length, 3);
  assert.match(cmds[0].textContent, /Bash · npm run build/);
  assert.match(cmds[1].textContent, /Read · a\.js/);
  // Un outil sans sujet ne laisse pas un separateur suspendu a l ecran.
  assert.equal(cmds[2].textContent, 'AskUserQuestion');
});

test('le remede s affiche avec son extrait ; le filet n en a pas', () => {
  const node = fauxElement('div');
  renderFailures(node, [invocation()]);
  assert.equal(parClasse(node, 'failure-remede').length, 1);
  assert.match(parClasse(node, 'remede-extrait')[0].textContent, /antislash final/);
  const zone = parClasse(node, 'remede-copie')[0];
  assert.equal(zone.attrs['aria-live'], 'polite');

  const filet = fauxElement('div');
  renderFailures(filet, [invocation({ patternId: 'inv-bash-unbalanced-quote' })]);
  assert.equal(parClasse(filet, 'failure-remede').length, 0, 'jamais de conseil invente');
});

test('« Tout acquitter » n existe que s il reste a traiter, et emet l intention', () => {
  const node = fauxElement('div');
  const recus = [];
  const episodes = [invocation(), invocation({ acknowledged: true, createdAt: T0 - 1000 })];
  renderFailures(node, episodes, { onAckGroup: eps => { recus.push(eps); return Promise.resolve(); } });
  const [btn] = parClasse(node, 'failure-ack');
  assert.match(btn.textContent, /Tout acquitter \(1\)/);
  btn.click();
  assert.equal(btn.disabled, true, 'desactive pendant l operation');
  assert.equal(recus[0].length, 2, 'l intention porte les episodes du groupe, l orchestrateur filtre');

  const solde = fauxElement('div');
  renderFailures(solde, [invocation({ acknowledged: true })], { onAckGroup: () => {} });
  assert.equal(parClasse(solde, 'failure-ack').length, 0);
  assert.ok(parClasse(solde, 'failure-group')[0].classList.contains('is-acked'));
});

test('sans onAckGroup la vue reste muette cote reseau : aucun bouton d acquittement', () => {
  const node = fauxElement('div');
  renderFailures(node, [invocation()]);
  assert.equal(parClasse(node, 'failure-ack').length, 0);
});

// Deplier une commande tronquee etait un geste de SOURIS uniquement : ni role,
// ni tabindex, ni annonce de l etat (WCAG 2.1.1 et 4.1.2). La ligne « non
// consignee » n a rien a deplier — elle reste du texte inerte, pas un faux
// bouton qui ment a la synthese vocale.
test('la commande tronquee se deplie au clavier et annonce son etat', () => {
  const node = fauxElement('div');
  renderFailures(node, [invocation(), invocation({ subject: '', createdAt: T0 - 1000 })]);
  const [cmd, absente] = parClasse(node, 'failure-cmd');

  assert.equal(cmd.attrs.role, 'button');
  assert.equal(cmd.attrs.tabindex, '0');
  assert.equal(cmd.attrs['aria-expanded'], 'false');
  cmd.handlers.keydown({ key: 'Enter', preventDefault() {} });
  assert.ok(cmd.classList.contains('is-open'));
  assert.equal(cmd.attrs['aria-expanded'], 'true');

  assert.equal(absente.attrs.role, undefined, 'rien a deplier, donc pas un bouton');
  assert.equal(absente.handlers.click, undefined);
});

// Un seul systeme de boutons pour le produit : la vue porte la classe commune
// au lieu de redecrire un look. Sans elle, le bouton retombe sur le bouton
// natif de l OS — gris clair sur panneau sombre, 1,3:1 de contraste.
test('tout bouton de la vue porte la classe du systeme de boutons', () => {
  const node = fauxElement('div');
  renderFailures(node, [invocation()], { onAckGroup: () => {} });
  const boutons = aPlat(node).filter(n => n.tagName === 'BUTTON');
  assert.ok(boutons.length >= 2, 'au moins Copier et Tout acquitter');
  for (const b of boutons) {
    assert.ok(b.classList.contains('obs-btn'), `bouton sans style commun : ${b.textContent}`);
  }
});

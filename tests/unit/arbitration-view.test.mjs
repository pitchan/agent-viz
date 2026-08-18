// La section « Arbitrages rendus » et les contrôles d'arbitrage d'une carte,
// testés sur un faux document — même parti que failures-view.test.mjs :
// pas de navigateur, pas de jsdom.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderArbitrated, arbitrationControls } from '../../src/web/observatory/arbitration-view.js';

function fauxElement(tag) {
  const classes = new Set();
  return {
    tagName: tag.toUpperCase(),
    children: [],
    handlers: {},
    dataset: {},
    attrs: {},
    value: '',
    type: '',
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

// Tous les noeuds de l'arbre, à plat — les assertions cherchent par classe.
const aPlat = n => [n, ...n.children.flatMap(aPlat)];
const parClasse = (racine, classe) =>
  aPlat(racine).filter(n => n.classList && n.classList.contains(classe));
const parBalise = (racine, balise) => aPlat(racine).filter(n => n.tagName === balise);

globalThis.document = { createElement: fauxElement };

const recArbitre = (id, sur = {}) => ({
  id, title: `titre ${id}`, statusAt: '2026-07-10T12:00:00.000Z',
  statusReason: 'tests vérifiés au terminal', ...sur,
});

test('la section est un accordéon replié qui annonce son compte', () => {
  // Arrange
  const node = fauxElement('div');
  // Act
  renderArbitrated(node, [recArbitre(1), recArbitre(2)]);
  // Assert
  const [section] = parClasse(node, 'advisor-arbitrated');
  assert.equal(section.tagName, 'DETAILS', 'accordéon natif, replié par défaut');
  assert.equal(section.attrs.open, undefined, 'jamais déplié d’office');
  const [resume] = parBalise(section, 'SUMMARY');
  assert.equal(resume.textContent, 'Arbitrages rendus (2)');
});

test('chaque carte arbitrée montre la raison, la date, et un Réactiver d’un clic', () => {
  // Arrange
  const node = fauxElement('div');
  // Act
  renderArbitrated(node, [recArbitre(7)]);
  // Assert
  const [carte] = parClasse(node, 'advisor-card');
  assert.equal(carte.dataset.recId, '7', 'la délégation de clic existante retrouve la carte');
  assert.equal(parClasse(carte, 'advisor-card-title')[0].textContent, 'titre 7');
  assert.match(parClasse(carte, 'advisor-card-arbitrated')[0].textContent,
    /^Arbitré le 10\/07\/2026 — tests vérifiés au terminal$/);
  const [btn] = parClasse(carte, 'obs-btn');
  assert.equal(btn.textContent, 'Réactiver');
  assert.equal(btn.dataset.status, 'new', 'la réactivation passe par le rail de statut existant');
});

test('sans arbitrage rendu, aucune section — pas de tiroir vide', () => {
  // Arrange
  const node = fauxElement('div');
  // Act
  renderArbitrated(node, []);
  // Assert
  assert.equal(node.children.length, 0);
});

test('le champ raison ne se montre qu’après « Déjà arbitré »', () => {
  // Arrange
  const wrap = arbitrationControls(() => {});
  // Act
  const [toggle] = parClasse(wrap, 'obs-btn').filter(b => b.textContent === 'Déjà arbitré');
  toggle.click();
  // Assert
  assert.equal(wrap.classList.contains('armed'), true);
  const [champ] = parClasse(wrap, 'advisor-arbitrate-reason');
  assert.equal(champ.attrs.placeholder, 'Raison de l’arbitrage (une ligne)');
});

test('Consigner sans raison ne consigne rien', () => {
  // Arrange
  let recu = null;
  const wrap = arbitrationControls(raison => { recu = raison; });
  const [consigner] = parClasse(wrap, 'obs-btn').filter(b => b.textContent === 'Consigner');
  parClasse(wrap, 'advisor-arbitrate-reason')[0].value = '   ';
  // Act
  consigner.click();
  // Assert
  assert.equal(recu, null, 'une raison blanche ne part jamais au serveur');
});

test('Consigner porte la raison, débarrassée de ses blancs', () => {
  // Arrange
  let recu = null;
  const wrap = arbitrationControls(raison => { recu = raison; });
  const [consigner] = parClasse(wrap, 'obs-btn').filter(b => b.textContent === 'Consigner');
  parClasse(wrap, 'advisor-arbitrate-reason')[0].value = '  déjà pesé au boulot  ';
  // Act
  consigner.click();
  // Assert
  assert.equal(recu, 'déjà pesé au boulot');
});

test('le bouton Consigner ne porte pas de data-status — la délégation ne doit pas le voir', () => {
  // Arrange
  const wrap = arbitrationControls(() => {});
  // Act
  const boutons = parClasse(wrap, 'obs-btn');
  // Assert
  for (const b of boutons) assert.equal(b.dataset.status, undefined);
});

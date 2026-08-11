// Le pont `node:test` -> vitest, teste par injection. Les doublures ci-dessous
// tiennent la place des primitives de vitest : la fabrique ne doit rien
// importer d'elle-meme, sinon elle ne serait testable que sous vitest.
//
// Ces tests tournent sous les DEUX executeurs, et c'est voulu : sous
// `node --test` ils decrivent la semantique de reference, sous vitest ils
// verifient que le pont la replique.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBridge } from '../../test-support/bridge/create-bridge.mjs';

// Fabrique de doublures : un defaut valide, chaque test ne declare que ce qui
// differe (tests/CLAUDE.md, section 2).
function primitives(overrides = {}) {
  const journal = { tests: [], afterAll: [], beforeEach: [] };
  return {
    journal,
    deps: {
      test: (nom, fn) => journal.tests.push({ nom, fn }),
      afterAll: fn => journal.afterAll.push(fn),
      beforeEach: fn => journal.beforeEach.push(fn),
      vi: { useFakeTimers() {}, advanceTimersByTime() {}, useRealTimers() {} },
      ...overrides,
    },
  };
}

test('le module rendu est appelable, comme node:test l est', () => {
  // Arrange
  const { journal, deps } = primitives();
  const pont = createBridge(deps);
  // Act
  pont('un nom', () => {});
  // Assert
  assert.equal(journal.tests[0].nom, 'un nom');
});

test('`test` pointe sur le module lui-meme, pour les deux formes d import', () => {
  // Arrange
  const { deps } = primitives();
  // Act
  const pont = createBridge(deps);
  // Assert
  assert.equal(pont.test, pont);
});

test('`after` va sur afterAll, pas sur afterEach', () => {
  // Arrange
  const { journal, deps } = primitives();
  const pont = createBridge(deps);
  const nettoyage = () => {};
  // Act
  pont.after(nettoyage);
  // Assert
  assert.deepEqual(journal.afterAll, [nettoyage]);
});

test('t.mock.method compte les appels et laisse passer le comportement d origine', async () => {
  // Arrange
  const { journal, deps } = primitives();
  const pont = createBridge(deps);
  const cible = { calcul: (a, b) => a + b };
  let espion = null;
  pont('sujet', t => { espion = t.mock.method(cible, 'calcul'); cible.calcul(2, 3); });
  // Act
  await journal.tests[0].fn();
  // Assert
  assert.equal(espion.mock.callCount(), 1);
});

test('l espion sans implementation rend la valeur de l original', async () => {
  // Arrange
  const { journal, deps } = primitives();
  const pont = createBridge(deps);
  const cible = { calcul: (a, b) => a + b };
  let resultat = null;
  pont('sujet', t => { t.mock.method(cible, 'calcul'); resultat = cible.calcul(2, 3); });
  // Act
  await journal.tests[0].fn();
  // Assert
  assert.equal(resultat, 5);
});

test('t.mock.method avec implementation substitue le comportement', async () => {
  // Arrange
  const { journal, deps } = primitives();
  const pont = createBridge(deps);
  const cible = { lire: () => 'reel' };
  let vu = null;
  pont('sujet', t => { t.mock.method(cible, 'lire', () => 'double'); vu = cible.lire(); });
  // Act
  await journal.tests[0].fn();
  // Assert
  assert.equal(vu, 'double');
});

test('les arguments d un appel sont sous la cle `arguments`, comme node:test les range', async () => {
  // Arrange
  const { journal, deps } = primitives();
  const pont = createBridge(deps);
  const cible = { ecrire: () => {} };
  let espion = null;
  pont('sujet', t => { espion = t.mock.method(cible, 'ecrire'); cible.ecrire('compaction', 2); });
  // Act
  await journal.tests[0].fn();
  // Assert
  assert.deepEqual(espion.mock.calls[0].arguments, ['compaction', 2]);
});

test('la methode remplacee est rendue quand le test se termine, meme s il jette', async () => {
  // Arrange
  const { journal, deps } = primitives();
  const pont = createBridge(deps);
  const origine = () => 'reel';
  const cible = { lire: origine };
  pont('sujet', t => { t.mock.method(cible, 'lire', () => 'double'); throw new Error('echec du test'); });
  // Act
  await assert.rejects(() => journal.tests[0].fn(), /echec du test/);
  // Assert
  assert.equal(cible.lire, origine);
});

test('t.mock.timers.enable demande a l executeur de simuler les seules APIs citees', async () => {
  // Arrange
  const vus = [];
  const { journal, deps } = primitives({
    vi: { useFakeTimers: o => vus.push(o), advanceTimersByTime() {}, useRealTimers() {} },
  });
  const pont = createBridge(deps);
  pont('sujet', t => { t.mock.timers.enable({ apis: ['setTimeout'] }); });
  // Act
  await journal.tests[0].fn();
  // Assert
  assert.deepEqual(vus, [{ toFake: ['setTimeout'] }]);
});

test('t.mock.timers.tick avance du delai demande', async () => {
  // Arrange
  const avances = [];
  const { journal, deps } = primitives({
    vi: { useFakeTimers() {}, advanceTimersByTime: ms => avances.push(ms), useRealTimers() {} },
  });
  const pont = createBridge(deps);
  pont('sujet', t => { t.mock.timers.enable({ apis: ['setTimeout'] }); t.mock.timers.tick(5000); });
  // Act
  await journal.tests[0].fn();
  // Assert
  assert.deepEqual(avances, [5000]);
});

test('les temporisateurs sont rendus au reel a la fin du test', async () => {
  // Arrange
  let rendus = 0;
  const { journal, deps } = primitives({
    vi: { useFakeTimers() {}, advanceTimersByTime() {}, useRealTimers: () => { rendus += 1; } },
  });
  const pont = createBridge(deps);
  pont('sujet', t => { t.mock.timers.enable({ apis: ['setTimeout'] }); });
  // Act
  await journal.tests[0].fn();
  // Assert
  assert.equal(rendus, 1);
});

test('t.after s execute apres le corps du test', async () => {
  // Arrange
  const ordre = [];
  const { journal, deps } = primitives();
  const pont = createBridge(deps);
  pont('sujet', t => { t.after(() => ordre.push('nettoyage')); ordre.push('corps'); });
  // Act
  await journal.tests[0].fn();
  // Assert
  assert.deepEqual(ordre, ['corps', 'nettoyage']);
});

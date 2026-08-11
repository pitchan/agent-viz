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

// Fabrique du pont `node:test`. Pure : elle recoit les primitives de
// l'executeur et ne connait ni `vitest` ni `node:module`.
//
// `after` de node:test s'execute apres TOUS les tests du fichier — c'est
// `afterAll` de vitest, pas `afterEach`. La confusion serait invisible : les
// 5 fichiers concernes nettoient des dossiers temporaires, et un nettoyage
// trop precoce ne se voit qu'en aval, dans un autre test.
export function createBridge({ test: runTest, afterAll, beforeEach }) {
  const pont = (nom, fn) => runTest(nom, () => fn());
  pont.test = pont;
  pont.after = fn => afterAll(fn);
  pont.beforeEach = fn => beforeEach(fn);
  return pont;
}

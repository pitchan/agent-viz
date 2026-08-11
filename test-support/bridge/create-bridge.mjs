// Fabrique du pont `node:test`. Pure : elle recoit les primitives de
// l'executeur et ne connait ni `vitest` ni `node:module`.
//
// `after` de node:test s'execute apres TOUS les tests du fichier — c'est
// `afterAll` de vitest, pas `afterEach`.
//
// `t.mock.method` restaure AUTOMATIQUEMENT en fin de test. `vi.spyOn` ne le
// fait pas : c'est la divergence mesuree le 2026-08-11 (doc/36, annexe A.2,
// sonde no 1), et elle est invisible a la lecture. Le remplacement est donc
// ecrit ici, pas delegue.
function creerContexte(vi) {
  const restaurations = [];
  const apresTest = [];
  let fauxTemporisateurs = false;

  const method = (cible, cle, impl) => {
    const origine = cible[cle];
    const appels = [];
    const remplacement = function (...args) {
      appels.push({ arguments: args });
      return (impl ?? origine).apply(this, args);
    };
    remplacement.mock = {
      calls: appels,
      callCount: () => appels.length,
      restore: () => { cible[cle] = origine; },
    };
    cible[cle] = remplacement;
    restaurations.push(() => { cible[cle] = origine; });
    return remplacement;
  };

  const timers = {
    enable: ({ apis }) => { fauxTemporisateurs = true; vi.useFakeTimers({ toFake: apis }); },
    tick: ms => vi.advanceTimersByTime(ms),
  };

  return {
    contexte: { mock: { method, timers }, after: fn => apresTest.push(fn) },
    nettoyer: async () => {
      while (apresTest.length) await apresTest.shift()();
      while (restaurations.length) restaurations.pop()();
      if (fauxTemporisateurs) vi.useRealTimers();
    },
  };
}

export function createBridge({ test: runTest, afterAll, beforeEach, vi }) {
  const pont = (nom, fn) => runTest(nom, async () => {
    const { contexte, nettoyer } = creerContexte(vi);
    try {
      await fn(contexte);
    } finally {
      await nettoyer();
    }
  });
  pont.test = pont;
  pont.after = fn => afterAll(fn);
  pont.beforeEach = fn => beforeEach(fn);
  return pont;
}

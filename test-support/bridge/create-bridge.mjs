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

  // Les trois phases sont ISOLEES : une fonction `t.after` qui jette ne doit
  // empecher ni la restauration des mocks, ni le retour aux temporisateurs
  // reels. Sinon l'etat fuit vers les tests suivants et la panne se manifeste
  // ailleurs qu'a l'endroit ou elle est nee. L'erreur n'est pas avalee pour
  // autant : elle est rendue a l'appelant.
  const nettoyer = async () => {
    let premiereErreur = null;
    while (apresTest.length) {
      try {
        await apresTest.shift()();
      } catch (e) {
        premiereErreur ??= e;
      }
    }
    while (restaurations.length) restaurations.pop()();
    if (fauxTemporisateurs) vi.useRealTimers();
    return premiereErreur;
  };

  return {
    contexte: { mock: { method, timers }, after: fn => apresTest.push(fn) },
    nettoyer,
  };
}

export function createBridge({ test: runTest, afterAll, beforeEach, vi }) {
  const pont = (nom, fn) => runTest(nom, async () => {
    const { contexte, nettoyer } = creerContexte(vi);
    let erreurDuCorps = null;
    try {
      await fn(contexte);
    } catch (e) {
      erreurDuCorps = e;
    }
    const erreurDeNettoyage = await nettoyer();
    // Le corps prime : son erreur dit ce que le test voulait prouver. Celle du
    // nettoyage ne doit jamais la masquer.
    if (erreurDuCorps) throw erreurDuCorps;
    if (erreurDeNettoyage) throw erreurDeNettoyage;
  });
  pont.test = pont;
  pont.after = fn => afterAll(fn);
  pont.beforeEach = fn => beforeEach(fn);
  return pont;
}

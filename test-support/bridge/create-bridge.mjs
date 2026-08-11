// Fabrique du pont `node:test` vers vitest. PURE : elle recoit les primitives
// de l'executeur par injection et ne connait ni `vitest` ni `node:module` —
// c'est ce qui la rend testable sans monkey-patching (regle D du CLAUDE.md
// racine), et ce qui permet a ses tests de tourner sous les DEUX executeurs.
//
// Trois points etablis par la mesure du 2026-08-11, qu'aucune lecture ne
// montre :
//   - `after` de node:test s'execute apres TOUS les tests du fichier : c'est
//     `afterAll` de vitest, pas `afterEach` ;
//   - `t.mock.method` RESTAURE automatiquement en fin de test, la ou
//     `vi.spyOn` ne le fait pas — d'ou le remplacement ecrit ici plutot que
//     delegue ;
//   - une API non implementee doit JETER en se nommant. Un no-op retirerait
//     des tests du filet en silence : la maladie du constat C1.

const FICHIER = 'test-support/bridge/create-bridge.mjs';

// `node:test` echoue sur TOUTE valeur jetee, y compris `0`, `''`, `null`,
// `NaN` et `false`. Une sentinelle est donc obligatoire : tester la verite
// d'une erreur au lieu de sa presence rapporterait ces tests-la VERTS —
// un faux vert loge dans le composant meme qui existe pour les supprimer.
// Mesure le 2026-08-11, les cinq valeurs verifiees une par une.
const AUCUNE = Symbol('aucune erreur');

function refus(api) {
  return () => {
    throw new Error(
      `pont node:test : ${api} n est pas implemente. Aucun test du depot ne l utilisait `
      + `quand le pont a ete ecrit (mesure du 2026-08-11). Implemente-le dans ${FICHIER} `
      + `et ajoute son test — ne le contourne pas.`);
  };
}

const NON_IMPLEMENTE_MODULE = [
  'skip', 'only', 'todo', 'each', 'describe', 'it', 'suite', 'before', 'afterEach', 'mock',
];
const NON_IMPLEMENTE_CONTEXTE = ['test', 'skip', 'todo', 'diagnostic', 'plan'];

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

  const contexte = { mock: { method, timers }, after: fn => apresTest.push(fn) };
  for (const api of NON_IMPLEMENTE_CONTEXTE) contexte[api] = refus(`t.${api}`);

  // Les trois phases sont isolees CHACUNE DANS SON PROPRE `try`. Une erreur
  // dans l'une ne doit empecher aucune des deux autres : sinon l'etat fuit
  // vers les tests suivants — mocks non restaures, faux temporisateurs
  // toujours actifs — et la panne se manifeste ailleurs qu'a l'endroit ou
  // elle est nee, le mode de panne le plus couteux du chantier.
  // La premiere erreur rencontree est conservee et rendue, jamais avalee.
  let premiereErreur = AUCUNE;
  const garder = (e) => { if (premiereErreur === AUCUNE) premiereErreur = e; };

  const nettoyer = async () => {
    while (apresTest.length) {
      try { await apresTest.shift()(); } catch (e) { garder(e); }
    }
    while (restaurations.length) {
      try { restaurations.pop()(); } catch (e) { garder(e); }
    }
    if (fauxTemporisateurs) {
      try { vi.useRealTimers(); } catch (e) { garder(e); }
    }
    return premiereErreur;
  };

  return { contexte, nettoyer };
}

export function createBridge({ test: runTest, afterAll, beforeEach, vi }) {
  const pont = (nom, fn) => {
    if (typeof fn !== 'function') {
      throw new Error(
        `pont node:test : la forme test(nom, option, fn) n est pas implementee — aucun test `
        + `du depot n utilisait d option (mesure du 2026-08-11). Implemente-la dans ${FICHIER}.`);
    }
    return runTest(nom, async () => {
      const { contexte, nettoyer } = creerContexte(vi);
      let erreurDuCorps = AUCUNE;
      try {
        await fn(contexte);
      } catch (e) {
        erreurDuCorps = e;
      }
      const erreurDeNettoyage = await nettoyer();
      // Le corps prime : son erreur dit ce que le test voulait prouver. Celle
      // du nettoyage ne doit jamais la masquer. Comparaison a la sentinelle et
      // non a la verite : `throw 0` est une erreur, pas une absence d'erreur.
      if (erreurDuCorps !== AUCUNE) throw erreurDuCorps;
      if (erreurDeNettoyage !== AUCUNE) throw erreurDeNettoyage;
    });
  };
  pont.test = pont;
  pont.after = fn => afterAll(fn);
  pont.beforeEach = fn => beforeEach(fn);
  for (const api of NON_IMPLEMENTE_MODULE) pont[api] = refus(`test.${api}`);
  return pont;
}

'use strict';
// Le chargeur de modules du moteur — constat C5 de docs/audit-qualite-code.md.
//
// C2 avait posé `src/server/jsonl.js`, seul module de `src/server/` à savoir où vit la
// primitive de décodage. C5 demande le même geste pour la résolution du dossier
// de configuration, et C3 le demandera pour l'accumulation d'usage. Ce qui est
// commun aux trois n'est ni le décodage, ni la résolution, ni l'accumulation :
// c'est **charger un module du `dist` du moteur, et échouer EN LE DISANT si le
// build manque**. Une seule raison de changer, donc un seul fichier.
//
// Chaque domaine garde son propre pont (`jsonl.js`, `claude-dir.js`, …) : ce
// sont des voisinages différents, et les mettre ensemble sous prétexte qu'ils
// traversent la même frontière recréerait un fourre-tout.
//
// Pourquoi un `require` direct et non un `import()` asynchrone, contrairement à
// `observatory/engine.js` : depuis Node 22.12 un module CommonJS peut charger un
// module ES de façon SYNCHRONE tant qu'il n'a pas d'attente de haut niveau, et
// `package.json` promet déjà `engines.node >= 24`. Vérifié en exécutant.
//
// `dist/engine/package.json` porte `{"type":"module"}`, ce qui fait lire ce
// sous-arbre comme de l'ES alors que ce paquet-ci est en CommonJS. Ce marqueur
// n'est plus versionné : il est écrit par le build (`scripts/dist-esm-marker.mjs`).

const path = require('path');

const DIST = path.join(__dirname, '..', '..', 'dist', 'engine');

/**
 * @param {string} rel   chemin DANS le `dist` du moteur, ex. `core/jsonl.js`.
 *   Relatif au `dist` et non au module appelant : un pont placé ailleurs dans
 *   `src/server/` ne peut pas se tromper d'un niveau sans que rien ne le dise.
 * @param {string[]} noms les exports attendus. Un manque signale un build
 *   périmé, pas un build absent — deux causes qui envoient chercher à des
 *   endroits opposés.
 * @param {string} etiquette le préfixe des messages, ex. `jsonl`.
 */
function requireEngineModule(rel, noms, etiquette) {
  const chemin = path.join(DIST, rel);
  let module;
  try {
    module = require(chemin);
  } catch (err) {
    // Casser bruyamment, jamais silencieusement — c'est la règle que C1 a
    // rappelée au prix d'une perte de capture. Un message cryptique de module
    // introuvable enverrait chercher un paquet npm manquant ; la cause réelle
    // est un build absent.
    throw new Error(
      `[${etiquette}] le module « ${rel} » du moteur est introuvable. Ce dossier ` +
      'est produit par `npm run build`, que le script `prepare` lance ' +
      'automatiquement à l’installation — un dépôt cloné puis jamais installé ' +
      `n’en a pas. Lancez \`npm run build\`. Cause d’origine : ${err.message}`,
    );
  }

  const manquants = noms.filter(nom => typeof module[nom] !== 'function');
  if (manquants.length > 0) {
    throw new Error(
      `[${etiquette}] ${manquants.map(n => `\`${n}\``).join(', ')} absente(s) du ` +
      `module construit « ${rel} » : le build est périmé par rapport à la source ` +
      'TypeScript. Relancez `npm run build`.',
    );
  }
  return module;
}

module.exports = { requireEngineModule };

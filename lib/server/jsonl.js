'use strict';
// Pont CommonJS vers la primitive de décodage JSONL du moteur — constat C2 de
// docs/audit-qualite-code.md (le décodage était réimplémenté sur 7 fichiers
// serveur, avec une tolérance au BOM incidente et inégale).
//
// Ce module est le SEUL de `lib/` à savoir où vit la primitive, exactement
// comme `observatory/engine.js` est le seul à savoir où vit le moteur
// d'analyse. Tout le reste du serveur importe d'ici, jamais de `netgain/`.
//
// Pourquoi un `require` direct et non un `import()` asynchrone, contrairement à
// `observatory/engine.js` : depuis Node 22.12 un module CommonJS peut charger
// un module ES de façon SYNCHRONE tant qu'il n'a pas d'attente de haut niveau,
// et `package.json` promet déjà `engines.node >= 24`. Les sept appelants
// décodent dans des chemins synchrones ; les rendre asynchrones pour une
// contrainte que la plateforme n'impose plus aurait été un coût gratuit.
//
// `netgain/package.json` porte `{"type":"module"}`, ce qui fait lire ce
// sous-arbre comme de l'ES alors que ce paquet-ci est en CommonJS.

const CHEMIN = '../../netgain/dist/core/jsonl.js';

let primitive;
try {
  primitive = require(CHEMIN);
} catch (err) {
  // Casser bruyamment, jamais silencieusement — c'est la règle que C1 a rappelée
  // au prix d'une perte de capture. Un message cryptique de module introuvable
  // enverrait chercher un paquet manquant ; la cause réelle est un build absent.
  throw new Error(
    `[jsonl] la primitive de décodage du moteur est introuvable (${CHEMIN}). ` +
    'Ce dossier est produit par `npm run build`, que le script `prepare` lance ' +
    'automatiquement à l’installation — un dépôt cloné puis jamais installé n’en ' +
    `a pas. Lancez \`npm run build\`. Cause d’origine : ${err.message}`,
  );
}

const { decodeJsonlLine } = primitive;

if (typeof decodeJsonlLine !== 'function') {
  throw new Error(
    '[jsonl] `decodeJsonlLine` absente du module construit : le build est périmé ' +
    'par rapport à `netgain/src/core/jsonl.ts`. Relancez `npm run build`.',
  );
}

module.exports = { decodeJsonlLine };

'use strict';
// Pont CommonJS vers la tarification du moteur — constat C4 de
// docs/audit-qualite-code.md (le contrat de résultat pour un modèle inconnu
// divergeait : `{ usd: null, known: false }` côté moteur, un message
// silencieusement IGNORÉ côté serveur, et aucune information de complétude
// jusqu'au pilote temps réel).
//
// Quatrième pont de `src/server/`, après `jsonl.js` (C2), `claude-dir.js` (C5) et
// `usage.js` (C3). Le geste de traversée n'est écrit qu'une fois, dans
// `engine-require.js` — c'est la quatrième fois qu'il ne coûte pas une ligne.
//
// Ce module est le SEUL de `src/server/` à savoir que la FORMULE de coût et la
// NORMALISATION des identifiants de modèle vivent dans le moteur. Ce qui reste
// à `pricing.js` est ce qui n'appartient qu'au serveur : la carte de prix en
// mémoire (remplie au démarrage depuis la table du moteur, avec un miroir de
// repli pour la fenêtre d'amorçage), les métadonnées d'affichage `label` et
// `maxInput`, et la vigie LiteLLM.
//
// Pourquoi ce pont n'ajoute AUCUN mode de panne (vérifié en exécutant le
// 2026-08-11) : `dist/engine` écarté, le serveur refuse déjà de démarrer
// depuis C2 — c'est `src/server/jsonl.js` qui lève en premier, et le message
// nomme déjà la cause. Le moteur n'est jamais « absent » quand le serveur
// tourne.

const { requireEngineModule } = require('./engine-require');

// `pricingKindOf` est la contrepartie QUALITATIVE de `computeCost`, qui ne rend
// qu'un montant : elle nomme les trois cas — `tarife`, `zero-voulu`,
// `inconnu`. Le serveur en a besoin parce que les trois appellent trois
// conduites différentes, et parce que déduire le cas d'un montant nul est
// impossible : un modèle tarifé qui n'a produit aucun jeton coûte 0 $ lui
// aussi. C'est exactement la confusion qui faisait traiter `<synthetic>`
// — 80 occurrences sur 833 transcriptions — comme un modèle inconnu.
const { computeCost, normalizeModel, pricingKindOf } = requireEngineModule(
  'core/pricing.js',
  ['computeCost', 'normalizeModel', 'pricingKindOf'],
  'pricing');

module.exports = { computeCost, normalizeModel, pricingKindOf };

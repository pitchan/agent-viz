'use strict';
// Pont CommonJS vers la résolution du dossier de configuration — constat C5 de
// docs/audit-qualite-code.md (deux variables d'environnement désignaient le même
// dossier dans un seul paquet npm : `CLAUDE_CONFIG_DIR` côté produit,
// `NETGAIN_CLAUDE_DIR` côté moteur).
//
// Ce module est le SEUL de `src/server/` à savoir que cette résolution vit dans le
// moteur, même doctrine que `jsonl.js` pour le décodage et que
// `observatory/engine.js` pour le moteur d'analyse.
//
// La primitive vit côté TypeScript et non ici, pour la même raison qu'en C2 :
// une définition côté serveur aurait laissé la divergence serveur/moteur
// intacte, donc n'aurait pas fait C5. Ce qui était en cause n'était pas un
// doublon de code mais un doublon de VOCABULAIRE — le corriger demande un
// vocabulaire partagé, pas deux expressions qui se ressemblent.

const { requireEngineModule } = require('./engine-require');

const { resolveClaudeDir, resolveClaudeJsonPath, CLAUDE_DIR_ENV } = requireEngineModule(
  'core/claude-dir.js', ['resolveClaudeDir', 'resolveClaudeJsonPath'], 'claude-dir');

module.exports = { resolveClaudeDir, resolveClaudeJsonPath, CLAUDE_DIR_ENV };

'use strict';
// Pont ES vers la résolution du dossier de configuration — constat C5 de
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

import { requireEngineModule } from './engine-require.ts';

// Ruling R8 : `import type` seul. Le chargement réel reste `requireEngineModule`
// ci-dessous, INCHANGÉ (même chemin, même liste de noms — `CLAUDE_DIR_ENV`
// EXCLUE, comme avant : ce n'est pas une fonction, la vérification de
// `requireEngineModule` ne porte que sur les deux noms qui en sont).
import type * as EngineClaudeDir from '../engine/core/claude-dir.ts';

const mod = requireEngineModule(
  'core/claude-dir.js', ['resolveClaudeDir', 'resolveClaudeJsonPath'], 'claude-dir');

const resolveClaudeDir = mod.resolveClaudeDir as typeof EngineClaudeDir.resolveClaudeDir;
const resolveClaudeJsonPath = mod.resolveClaudeJsonPath as typeof EngineClaudeDir.resolveClaudeJsonPath;
// Constante non-fonction : jamais passée au filtre de `requireEngineModule`,
// donc jamais vérifiée par lui — le cast la recouvre du type réel sans
// prétendre à une garantie que le pont ne fait pas.
const CLAUDE_DIR_ENV = mod.CLAUDE_DIR_ENV as typeof EngineClaudeDir.CLAUDE_DIR_ENV;

export { resolveClaudeDir, resolveClaudeJsonPath, CLAUDE_DIR_ENV };

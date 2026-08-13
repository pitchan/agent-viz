'use strict';
// Pont ES vers la primitive d'accumulation d'usage du moteur — constat C3
// de docs/audit-qualite-code.md (l'accumulation des jetons était réimplémentée
// côté serveur et côté moteur, avec deux jeux de gardes qui n'étaient pas
// équivalents malgré ce que la fiche en disait).
//
// Troisième pont de `src/server/`, après `jsonl.js` (C2) et `claude-dir.js` (C5), et
// le geste de traversée n'est écrit qu'une fois : `engine-require.js` a été
// extrait au chantier précédent exactement pour porter celui-ci.
//
// Ce module est le SEUL de `src/server/` à savoir que cette accumulation vit dans le
// moteur. Ce qui reste côté serveur — le « dernier message » qui donne la
// taille de fenêtre de contexte, le modèle courant, le coût calculé à
// l'analyse — n'est pas de l'accumulation d'usage : c'est ce que le pilote
// temps réel en fait, et ça n'a aucune raison d'aller dans le noyau.

import { requireEngineModule } from './engine-require.js';

const { addUsage, emptyUsageBucket, finiteCount, isDedupableMsgId, sumUsageInto } =
  requireEngineModule(
    'core/usage.js',
    ['addUsage', 'emptyUsageBucket', 'finiteCount', 'isDedupableMsgId', 'sumUsageInto'],
    'usage');

export { addUsage, emptyUsageBucket, finiteCount, isDedupableMsgId, sumUsageInto };

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

import { requireEngineModule } from './engine-require.ts';

// Ruling R8 (doc/36 §4.1) : `import type` seul — effacé à l'émission, aucune
// arête d'exécution nouvelle. Le chargement réel reste `requireEngineModule`
// ci-dessous, INCHANGÉ (même chemin, même liste de noms, même étiquette).
import type * as EngineUsage from '../engine/core/usage.ts';

const mod = requireEngineModule(
  'core/usage.js',
  ['addUsage', 'emptyUsageBucket', 'finiteCount', 'isDedupableMsgId', 'sumUsageInto'],
  'usage');

// Chaque nom recouvre son type réel du moteur — `mod.xxx` est `unknown`
// (retour de `requireEngineModule`), jamais `any` ; le cast vise le type
// IMPORTÉ, pas `any`.
const addUsage = mod.addUsage as typeof EngineUsage.addUsage;
const emptyUsageBucket = mod.emptyUsageBucket as typeof EngineUsage.emptyUsageBucket;
const finiteCount = mod.finiteCount as typeof EngineUsage.finiteCount;
const isDedupableMsgId = mod.isDedupableMsgId as typeof EngineUsage.isDedupableMsgId;
const sumUsageInto = mod.sumUsageInto as typeof EngineUsage.sumUsageInto;

export { addUsage, emptyUsageBucket, finiteCount, isDedupableMsgId, sumUsageInto };

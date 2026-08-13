'use strict';
// Pont ES vers la primitive de décodage JSONL du moteur — constat C2 de
// docs/audit-qualite-code.md (le décodage était réimplémenté sur 7 fichiers
// serveur, avec une tolérance au blanc incidente et inégale).
//
// Ce module est le SEUL de `src/server/` à savoir que le décodage vit dans le moteur,
// exactement comme `observatory/engine.js` est le seul à savoir où vit le moteur
// d'analyse. Tout le reste du serveur importe d'ici, jamais de `src/engine/`.
//
// Le geste de traversée lui-même — trouver le module dans le `dist`, échouer en
// nommant un build absent ou périmé — a été extrait dans `engine-require.js` au
// moment où C5 en a eu besoin une deuxième fois. Ce fichier-ci ne garde que ce
// qui lui est propre : QUEL module, et QUELS exports.

import { requireEngineModule } from './engine-require.ts';

const { decodeJsonlLine } = requireEngineModule('core/jsonl.js', ['decodeJsonlLine'], 'jsonl');

export { decodeJsonlLine };

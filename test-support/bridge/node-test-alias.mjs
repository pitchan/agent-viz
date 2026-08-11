// Cible du resolve.alias sur `node:test`, ajoutee en complement de
// install.mjs — mesure du 2026-08-11 (tache 7) : `Module._load` intercepte
// bien `require('node:test')` mais pas `import ... from 'node:test'` dans les
// fichiers `.test.mjs`, dont la resolution ESM ne passe pas par ce crochet.
// L'interception par Module._load n'est PAS retiree : elle reste necessaire
// pour les 42 fichiers `.test.js` qui appellent `require('node:test')`. Ce
// module reexporte le meme pont, construit a partir des memes primitives
// vitest, pour que les deux voies d'acces rendent une seule et meme semantique.
import { test as executerTest, afterAll, beforeEach as avantChaqueTest, vi } from 'vitest';
import { createBridge } from './create-bridge.mjs';

const pont = createBridge({ test: executerTest, afterAll, beforeEach: avantChaqueTest, vi });

export const test = pont;
export const after = pont.after;
export const beforeEach = pont.beforeEach;
export default pont;

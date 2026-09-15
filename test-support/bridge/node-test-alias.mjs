// Cible du resolve.alias sur `node:test`, en complement de install.mjs et non en
// remplacement : `Module._load` intercepte `require('node:test')`, qu'appellent
// les fichiers `.test.cjs`, mais pas `import ... from 'node:test'` des `.test.mjs`.
//
// Ce module reexporte le meme pont, construit a partir des memes primitives
// vitest, pour que les deux voies d'acces rendent une seule et meme semantique.
import { test as executerTest, afterAll, beforeEach as avantChaqueTest, vi } from 'vitest';
import { createBridge } from './create-bridge.mjs';

const pont = createBridge({ test: executerTest, afterAll, beforeEach: avantChaqueTest, vi });

export const test = pont;
export const after = pont.after;
export const beforeEach = pont.beforeEach;
export default pont;

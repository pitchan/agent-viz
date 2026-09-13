// Couture d'installation du pont : le monkey-patching que la regle D du CLAUDE.md
// racine proscrit ailleurs est ici le seul moyen d'atteindre les `require('node:test')`
// des tests CommonJS sans les modifier. Toute la logique vit dans la fabrique, pure et testee.
import Module from 'node:module';
import { test, afterAll, beforeEach, vi } from 'vitest';
import { createBridge } from './create-bridge.mjs';

const pont = createBridge({ test, afterAll, beforeEach, vi });

const chargeur = Module._load;
Module._load = function (requete, parent, estPrincipal) {
  if (requete === 'node:test' || requete === 'test') return pont;
  return chargeur.apply(this, arguments);
};

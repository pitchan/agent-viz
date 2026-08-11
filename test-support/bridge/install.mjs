// Couture d'installation du pont. Ce fichier fait le monkey-patching que la
// regle D du CLAUDE.md racine proscrit ailleurs : c'est le seul endroit ou il
// est inevitable — on ne peut pas injecter dans `require('node:test')` des 42
// fichiers de tests sans y toucher, et y toucher est precisement ce que
// l'etape 1 interdit. L'ecart est donc assume et confine a ce fichier ; toute
// la logique vit dans la fabrique, qui est pure et testee.
import Module from 'node:module';
import { test, afterAll, beforeEach, vi } from 'vitest';
import { createBridge } from './create-bridge.mjs';

const pont = createBridge({ test, afterAll, beforeEach, vi });

const chargeur = Module._load;
Module._load = function (requete, parent, estPrincipal) {
  if (requete === 'node:test' || requete === 'test') return pont;
  return chargeur.apply(this, arguments);
};

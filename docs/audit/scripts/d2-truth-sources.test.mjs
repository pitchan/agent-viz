import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findTruthSources } from './d2-truth-sources.mjs';

test('contrôle positif : un tarif défini deux fois AVEC LA MÊME VALEUR est un miroir candidat', () => {
  const tarif = `'claude-opus-5': { input: 5e-6, output: 2.5e-5, cacheCreate: 6.25e-6, cacheRead: 5e-7 }`;
  const found = findTruthSources([
    { path: 'lib/server/pricing.js', zone: 'server', text: `const T = { ${tarif} };` },
    { path: 'netgain/src/core/pricing.ts', zone: 'engine', text: `const T = { ${tarif} };` },
  ]);
  const c = found.find(x => x.cle === 'claude-opus-5');
  assert.equal(c.definitions.length, 2);
  assert.equal(c.valeursDistinctes, 1, 'mêmes taux → une seule valeur distincte');
  assert.equal(c.niveau, null, 'le script propose, il ne classe pas');
});

test('contrôle positif : un tarif DIVERGENT est signalé comme tel, ce qui est le fait recherché', () => {
  const found = findTruthSources([
    { path: 'a.js', zone: 'server', text: `const T = { 'claude-opus-5': { input: 5e-6, output: 2.5e-5 } };` },
    { path: 'b.ts', zone: 'engine', text: `const T = { 'claude-opus-5': { input: 9e-6, output: 2.5e-5 } };` },
  ]);
  assert.equal(found.find(x => x.cle === 'claude-opus-5').valeursDistinctes, 2);
});

test('contrôle positif : un seuil de règle défini deux fois est trouvé', () => {
  const found = findTruthSources([
    { path: 'a.js', zone: 'server', text: `R1: Object.freeze({ minShareOfNet: 0.20 }),` },
    { path: 'b.ts', zone: 'engine', text: `R1: { minShareOfNet: 0.20 },` },
  ]);
  assert.ok(found.some(x => x.categorie === 'seuil-de-regle' && x.cle === 'R1'));
});

test('contrôle négatif : une valeur définie dans un seul fichier n’est pas un candidat', () => {
  const found = findTruthSources([
    { path: 'a.js', zone: 'server', text: `const T = { 'claude-opus-5': { input: 5e-6, output: 1e-5 } };` },
  ]);
  assert.equal(found.length, 0);
});

test('contrôle négatif : une simple MENTION sans valeur n’est pas une définition', () => {
  const found = findTruthSources([
    { path: 'a.js', zone: 'server', text: `if (model === 'claude-opus-5') return;` },
    { path: 'b.ts', zone: 'engine', text: `log('claude-opus-5');` },
  ]);
  assert.equal(found.length, 0, 'D2 ne doit compter que des définitions valuées');
});

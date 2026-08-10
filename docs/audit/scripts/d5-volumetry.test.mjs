import { test } from 'node:test';
import assert from 'node:assert/strict';
import { measure } from './d5-volumetry.mjs';

test('contrôle positif : une fonction est mesurée du mot-clé à son accolade fermante', () => {
  const text = `function f(a) {\n  if (a) {\n    return 1;\n  }\n  return 2;\n}\n`;
  const { parFichier } = measure([{ path: 'a.js', zone: 'server', text }]);
  assert.deepEqual(parFichier[0].fonctionsMotCleFunction, [{ ligneDebut: 1, ligneFin: 6 }]);
});

test('contrôle positif : une fonction IMBRIQUÉE est comptée elle aussi', () => {
  const text = `function outer() {\n  function inner() {\n    return 1;\n  }\n  return inner;\n}\n`;
  const { parFichier } = measure([{ path: 'a.js', zone: 'server', text }]);
  assert.deepEqual(parFichier[0].fonctionsMotCleFunction, [
    { ligneDebut: 1, ligneFin: 6 },
    { ligneDebut: 2, ligneFin: 4 },
  ]);
});

test('contrôle négatif : une accolade dans une chaîne ne fausse pas le comptage', () => {
  const text = `function f() {\n  const s = "} piege {";\n  return s;\n}\n`;
  const { parFichier } = measure([{ path: 'a.js', zone: 'server', text }]);
  assert.deepEqual(parFichier[0].fonctionsMotCleFunction, [{ ligneDebut: 1, ligneFin: 4 }]);
});

test('contrôle négatif : une fonction fléchée n’est PAS comptée — la métrique le dit dans son nom', () => {
  const { parFichier } = measure([{ path: 'a.js', zone: 'server', text: `const f = (a) => {\n  return a;\n};\n` }]);
  assert.deepEqual(parFichier[0].fonctionsMotCleFunction, []);
});

test('la distribution donne médiane, p90 et maximum', () => {
  const files = [1, 2, 3, 40].map((n, i) => ({ path: `f${i}.js`, zone: 'server', text: 'const a = 1;\n'.repeat(n) }));
  const { distribution } = measure(files);
  assert.equal(distribution.lignes.max, 41);
  assert.ok(distribution.lignes.mediane <= distribution.lignes.p90);
});

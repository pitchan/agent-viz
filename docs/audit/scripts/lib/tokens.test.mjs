import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenize } from './tokens.mjs';

test('contrôle positif : les chaînes et les nombres sont neutralisés', () => {
  const t = tokenize(`const a = "bonjour"; const b = 42;`);
  assert.deepEqual(t.map(x => x.v), ['const', 'a', '=', 'STR', ';', 'const', 'b', '=', 'NUM', ';']);
});

test('contrôle négatif : les commentaires disparaissent, les lignes restent justes', () => {
  const t = tokenize(`// entête\nconst a = 1;\n/* bloc\n   sur deux lignes */\nconst b = 2;\n`);
  assert.deepEqual(t.map(x => x.v), ['const', 'a', '=', 'NUM', ';', 'const', 'b', '=', 'NUM', ';']);
  assert.equal(t[0].line, 2);
  assert.equal(t[5].line, 5);
});

test('un gabarit multiligne compte comme une seule chaîne', () => {
  const t = tokenize('const a = `x\ny`;\nconst b = 3;');
  assert.deepEqual(t.map(x => x.v), ['const', 'a', '=', 'STR', ';', 'const', 'b', '=', 'NUM', ';']);
  assert.equal(t[5].line, 3);
});

test('contrôle positif : une apostrophe DANS une expression rationnelle littérale ne fausse pas le découpage du code réel qui suit', () => {
  const t = tokenize(`const re = /doesn't/;\nconst b = 2;`);
  assert.deepEqual(t.map(x => x.v), ['const', 're', '=', "/doesn't/", ';', 'const', 'b', '=', 'NUM', ';']);
});

test('contrôle négatif : une division n\'est PAS avalée comme une expression rationnelle', () => {
  const t = tokenize(`const r = a / b; const s = c / d;`);
  assert.deepEqual(t.map(x => x.v), [
    'const', 'r', '=', 'a', '/', 'b', ';', 'const', 's', '=', 'c', '/', 'd', ';',
  ]);
});

test('contrôle positif : deux expressions rationnelles DIFFÉRENTES produisent des jetons DIFFÉRENTS (D1 ne doit pas les fusionner)', () => {
  const t = tokenize(`const a = /foo/;\nconst b = /bar/;`);
  assert.deepEqual(t.map(x => x.v), ['const', 'a', '=', '/foo/', ';', 'const', 'b', '=', '/bar/', ';']);
  assert.notEqual(t[3].v, t[8].v);
});

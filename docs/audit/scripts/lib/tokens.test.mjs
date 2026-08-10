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

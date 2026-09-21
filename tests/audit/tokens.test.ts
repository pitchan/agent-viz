import { expect, test } from 'vitest';
import { tokenize } from '../../docs/audit/scripts/lib/tokens.ts';

test('contrôle positif : les chaînes et les nombres sont neutralisés', () => {
  const t = tokenize(`const a = "bonjour"; const b = 42;`);
  expect(t.map(x => x.v)).toEqual(['const', 'a', '=', 'STR', ';', 'const', 'b', '=', 'NUM', ';']);
});

test('contrôle négatif : les commentaires disparaissent, les lignes restent justes', () => {
  const t = tokenize(`// entête\nconst a = 1;\n/* bloc\n   sur deux lignes */\nconst b = 2;\n`);
  expect(t.map(x => x.v)).toEqual(['const', 'a', '=', 'NUM', ';', 'const', 'b', '=', 'NUM', ';']);
  expect(t[0]!.line).toBe(2);
  expect(t[5]!.line).toBe(5);
});

test('un gabarit multiligne compte comme une seule chaîne', () => {
  const t = tokenize('const a = `x\ny`;\nconst b = 3;');
  expect(t.map(x => x.v)).toEqual(['const', 'a', '=', 'STR', ';', 'const', 'b', '=', 'NUM', ';']);
  expect(t[5]!.line).toBe(3);
});

test('contrôle positif : une apostrophe DANS une expression rationnelle littérale ne fausse pas le découpage du code réel qui suit', () => {
  const t = tokenize(`const re = /doesn't/;\nconst b = 2;`);
  expect(t.map(x => x.v)).toEqual(['const', 're', '=', "/doesn't/", ';', 'const', 'b', '=', 'NUM', ';']);
});

test('contrôle négatif : une division n\'est PAS avalée comme une expression rationnelle', () => {
  const t = tokenize(`const r = a / b; const s = c / d;`);
  expect(t.map(x => x.v)).toEqual([
    'const', 'r', '=', 'a', '/', 'b', ';', 'const', 's', '=', 'c', '/', 'd', ';',
  ]);
});

test('contrôle positif : deux expressions rationnelles DIFFÉRENTES produisent des jetons DIFFÉRENTS (D1 ne doit pas les fusionner)', () => {
  const t = tokenize(`const a = /foo/;\nconst b = /bar/;`);
  expect(t.map(x => x.v)).toEqual(['const', 'a', '=', '/foo/', ';', 'const', 'b', '=', '/bar/', ';']);
  expect(t[3]!.v).not.toBe(t[8]!.v);
});

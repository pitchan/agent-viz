// Un `describe` n a qu un emploi admis : cadrer un hook (beforeEach, afterEach,
// beforeAll, afterAll) qui ne vaut que pour une partie du fichier
// (cf. `tests/CLAUDE.md` § 1). Tout autre `describe` est decoratif : il redit le
// chemin du fichier et masque les `const` dupliques d un groupe a l autre.
//
// La lecture passe par l analyseur de TypeScript et non par une regex : un
// hook doit etre une instruction DIRECTE du bloc, pas un mot cite dans une
// chaine ou imbrique dans un test.
import { expect, test } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const HOOKS = new Set(['beforeEach', 'afterEach', 'beforeAll', 'afterAll']);
const GROUPES = new Set(['describe', 'suite']);

// `describe(...)`, `describe.skip(...)`, `describe.each(t)(...)` : on remonte
// jusqu a l identifiant racine de l expression appelee.
function racine(expr: ts.Expression): string | undefined {
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr)) return racine(expr.expression);
  if (ts.isCallExpression(expr)) return racine(expr.expression);
  return undefined;
}

function appelle(stmt: ts.Statement, noms: Set<string>) {
  return ts.isExpressionStatement(stmt) && ts.isCallExpression(stmt.expression) &&
    noms.has(racine(stmt.expression.expression) ?? '');
}

function describesDecoratifs(source: string, fichier = 'x.ts'): number[] {
  const sf = ts.createSourceFile(fichier, source, ts.ScriptTarget.Latest, true);
  const lignes: number[] = [];
  const visite = (n: ts.Node) => {
    if (ts.isCallExpression(n) && GROUPES.has(racine(n.expression) ?? '')) {
      const rappel = n.arguments.find(a => ts.isArrowFunction(a) || ts.isFunctionExpression(a)) as
        ts.ArrowFunction | ts.FunctionExpression | undefined;
      const corps = rappel && ts.isBlock(rappel.body) ? rappel.body.statements : [];
      if (rappel && !corps.some(s => appelle(s, HOOKS))) lignes.push(sf.getLineAndCharacterOfPosition(n.getStart()).line + 1);
    }
    ts.forEachChild(n, visite);
  };
  visite(sf);
  return lignes;
}

function fichiersDeTest() {
  const acc: string[] = [];
  const marche = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) marche(abs);
      else if (e.name.endsWith('.test.ts')) acc.push(abs);
    }
  };
  marche(path.join(ROOT, 'tests'));
  return acc;
}

test('le detecteur signale un describe sans hook et laisse passer celui qui cadre un beforeEach', () => {
  // Arrange
  const source = [
    "describe('decoratif', () => {",
    "  test('a', () => { beforeEach(() => {}); });",
    '});',
    "describe.each([1])('decoratif aussi', () => {});",
    "describe('admis', () => {",
    '  beforeEach(() => {});',
    "  test('b', () => {});",
    '});',
  ].join('\n');

  // Act
  const lignes = describesDecoratifs(source);

  // Assert — un hook imbrique dans un test ne compte pas
  expect(lignes).toEqual([1, 4]);
});

test('aucun fichier de tests/ ne porte de describe decoratif', () => {
  // Arrange
  const fichiers = fichiersDeTest();

  // Act
  const fautifs = fichiers.flatMap(abs =>
    describesDecoratifs(readFileSync(abs, 'utf8'), abs)
      .map(l => `${path.relative(ROOT, abs).replaceAll('\\', '/')}:${l}`));

  // Assert — l assiette d abord : un balayage qui ne voit rien passerait aussi
  expect(fichiers.length >= 100, `assiette suspecte : ${fichiers.length} fichiers vus`).toBeTruthy();
  expect(fautifs, 'describe sans hook : un fichier = une facette. Retirer l enveloppe, ' +
    'ou scinder en deux fichiers si le groupe couvre une autre facette (tests/CLAUDE.md § 1).').toEqual([]);
});

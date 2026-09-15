// Un spécificateur relatif (`./`, `../`) d'un `.ts` de `src/` ou de `tests/` désigne un fichier
// qui existe, tel qu'il est écrit. vitest résout en silence `./x.js` vers `./x.ts` ; Node et
// `node --test` ne le font pas, et ni `tsc` ni vitest ne rougissent. La règle est l'existence,
// pas l'extension : `'../../package.json'` est un import licite. Lecture SYNTAXIQUE (API de
// `typescript`) : un commentaire ou une chaîne ne sont jamais lus comme un import.
//
// Ce que ce filet ne prouve pas :
//   - les `.test.cjs`, les `.test.mjs` et `vitest.config.mts` : hors périmètre, parce que le vrai
//     chargeur de Node et vitest les chargent déjà et échouent sur une cible absente ;
//   - la casse : le disque de Windows ne la distingue pas, `./Usage.ts` y trouve `usage.ts` ;
//     `forceConsistentCasingInFileNames` du `tsconfig.json` la couvre au typecheck, pas ce filet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const ts = createRequire(path.join(ROOT, 'package.json'))('typescript');
const RACINES = ['src', 'tests'];

const rel = (abs) => path.relative(ROOT, abs).replaceAll('\\', '/');

function fichiersTs(dir) {
  return readdirSync(dir, { recursive: true })
    .map((nom) => path.join(dir, String(nom)))
    .filter((p) => p.endsWith('.ts') && statSync(p).isFile())
    .sort();
}

// Les quatre formes qui nomment un module : `import … from`, `export … from`, `import('…')`
// à littéral, et `import('…')` en position de type. La ligne rendue est celle du littéral,
// pour qu'un import écrit sur plusieurs lignes se retrouve à l'endroit du spécificateur.
function specificateurs(abs) {
  const sf = ts.createSourceFile(abs, readFileSync(abs, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const out = [];
  const garder = (litteral) => out.push({
    spec: litteral.text,
    ligne: sf.getLineAndCharacterOfPosition(litteral.getStart(sf)).line + 1,
  });
  const visiter = (n) => {
    if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n))
      && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) {
      garder(n.moduleSpecifier);
    } else if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const arg = n.arguments[0];
      if (arg && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg))) garder(arg);
    } else if (ts.isImportTypeNode(n)
      && ts.isLiteralTypeNode(n.argument) && ts.isStringLiteral(n.argument.literal)) {
      garder(n.argument.literal);
    }
    ts.forEachChild(n, visiter);
  };
  visiter(sf);
  return out;
}

export function lireRacines(dossiers) {
  let fichiers = 0;
  let relatifs = 0;
  const defauts = [];
  for (const dossier of dossiers) {
    for (const abs of fichiersTs(dossier)) {
      fichiers++;
      for (const { spec, ligne } of specificateurs(abs)) {
        if (!spec.startsWith('./') && !spec.startsWith('../')) continue;
        relatifs++;
        const cible = path.resolve(path.dirname(abs), spec);
        if (existsSync(cible) && statSync(cible).isFile()) continue;
        defauts.push(`${rel(abs)}:${ligne} : « ${spec} » ne désigne aucun fichier`);
      }
    }
  }
  return { fichiers, relatifs, defauts };
}

test('assiette : au moins 120 fichiers .ts et 300 spécificateurs relatifs lus sous src et tests', () => {
  // Arrange
  const dossiers = RACINES.map((r) => path.join(ROOT, r));
  // Act
  const { fichiers, relatifs } = lireRacines(dossiers);
  // Assert
  assert.ok(fichiers >= 120,
    `ASSIETTE : ${fichiers} fichier(s) .ts lu(s), attendu >= 120 — la marche ne voit plus le disque.`);
  assert.ok(relatifs >= 300,
    `ASSIETTE : ${relatifs} spécificateur(s) relatif(s) lu(s), attendu >= 300 — la lecture des imports ne mord plus.`);
});

test('chaque spécificateur relatif d\'un .ts de src et tests désigne un fichier qui existe', () => {
  // Arrange
  const dossiers = RACINES.map((r) => path.join(ROOT, r));
  // Act
  const { defauts } = lireRacines(dossiers);
  // Assert
  assert.deepEqual(defauts, [],
    `${defauts.length} spécificateur(s) relatif(s) sans fichier :\n  ${defauts.join('\n  ')}\n`
    + 'Remède : écrire le spécificateur en .ts, le nom réel de la source — vitest résout .js vers .ts '
    + 'en silence, Node ne le fait pas.');
});

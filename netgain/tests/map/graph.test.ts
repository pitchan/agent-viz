import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { mapHot, mapImpact, TargetNotFoundError } from '../../src/map/graph.js';

const root = mkdtempSync(path.join(tmpdir(), 'netgain-graph-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function fixture(rel: string, content: string): string {
  const p = path.join(root, rel);
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, content);
  return p;
}

// Mini-graphe : store ← a, b, cy1 (directs) ; ← c, d, cy2 (profondeur 2) ; ← e (profondeur 3).
// Les 4 formes d'arête : import statique, export-from, import() dynamique, require().
fixture('src/core/store.ts', 'export const store = 1;\n');
fixture('src/a.ts', "import { store } from './core/store';\nexport const a = store;\n");
fixture('src/b.ts', "export * from './core/store';\n");
fixture('src/c.ts', "import { a } from './a';\nexport const c = a;\n");
fixture('src/d.ts', "export const load = () => import('./b');\n");
fixture('src/e.ts', "const r = require('./c');\nexport const e = r;\n");
// Cycle : cy1 ↔ cy2, cy1 importe store — le BFS doit terminer.
fixture('src/cy1.ts', "import { store } from './core/store';\nimport { cy2 } from './cy2';\nexport const cy1 = store;\n");
fixture('src/cy2.ts', "import { cy1 } from './cy1';\nexport const cy2 = cy1;\n");
// Import relatif cassé = vrai trou de carte, compté, jamais deviné.
fixture('src/broken.ts', "import { nope } from './does-not-exist';\nexport const broken = nope;\n");
// Import externe (package/node:) = normal, PAS compté comme trou.
fixture('src/unrelated.ts', "import path from 'node:path';\nexport const u = path.sep;\n");
// Sous-projet NestJS-style : baseUrl → import non relatif 'src/thing'.
fixture('napp/tsconfig.json', '{ "compilerOptions": { "baseUrl": "./" } }\n');
fixture('napp/src/thing.ts', 'export const t = 1;\n');
fixture('napp/src/use.ts', "import { t } from 'src/thing';\nexport const use = t;\n");
// Sous-projet à alias paths : '@lib/*'.
fixture('lapp/tsconfig.json', '{ "compilerOptions": { "baseUrl": ".", "paths": { "@lib/*": ["src/lib/*"] } } }\n');
fixture('lapp/src/lib/util.ts', 'export const u = 1;\n');
fixture('lapp/src/consumer.ts', "import { u } from '@lib/util';\nexport const consumer = u;\n");

const norm = (p: string) => p.replaceAll('\\', '/');

describe('mapImpact — blast radius module-level exact', () => {
  test('transitif complet avec byDepth : import, export-from, import() dynamique, require()', async () => {
    const r = await mapImpact(root, 'src/core/store.ts');
    expect(r.direct).toBe(3);
    expect(r.transitive).toBe(7);
    expect(r.byDepth).toEqual({ 1: 3, 2: 3, 3: 1 });
    expect(r.dependents.map((d) => norm(d.file)).sort()).toEqual([
      'src/a.ts',
      'src/b.ts',
      'src/c.ts',
      'src/cy1.ts',
      'src/cy2.ts',
      'src/d.ts',
      'src/e.ts',
    ]);
    // tri : profondeur croissante puis chemin
    expect(r.dependents[0]).toMatchObject({ file: expect.stringMatching(/a\.ts$/), depth: 1 });
  });

  test('le cycle cy1 ↔ cy2 termine avec des profondeurs stables', async () => {
    const r = await mapImpact(root, 'src/core/store.ts');
    expect(r.dependents.find((d) => norm(d.file) === 'src/cy1.ts')).toMatchObject({ depth: 1 });
    expect(r.dependents.find((d) => norm(d.file) === 'src/cy2.ts')).toMatchObject({ depth: 2 });
  });

  test('cible tolérante aux séparateurs (backslash accepté)', async () => {
    const r = await mapImpact(root, 'src\\core\\store.ts');
    expect(r.direct).toBe(3);
  });

  test('suffixe non ambigu accepté (core/store.ts)', async () => {
    const r = await mapImpact(root, 'core/store.ts');
    expect(norm(r.target)).toBe('src/core/store.ts');
    expect(r.direct).toBe(3);
  });

  test('cible inconnue → TargetNotFoundError avec suggestions par basename', async () => {
    const err = await mapImpact(root, 'wrong/store.ts').then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(TargetNotFoundError);
    expect((err as TargetNotFoundError).suggestions.map(norm)).toContain('src/core/store.ts');
  });

  test('import non relatif résolu par le baseUrl du tsconfig le plus proche (NestJS-style)', async () => {
    const r = await mapImpact(root, 'napp/src/thing.ts');
    expect(r.direct).toBe(1);
    expect(norm(r.dependents[0]!.file)).toBe('napp/src/use.ts');
  });

  test('alias paths du tsconfig résolus (@lib/*)', async () => {
    const r = await mapImpact(root, 'lapp/src/lib/util.ts');
    expect(r.direct).toBe(1);
    expect(norm(r.dependents[0]!.file)).toBe('lapp/src/consumer.ts');
  });

  test('import relatif cassé → compté unresolvedImports ; les packages externes non comptés', async () => {
    const r = await mapImpact(root, 'src/core/store.ts');
    expect(r.unresolvedImports).toBe(1);
  });
});

describe('mapHot — fichiers les plus importés', () => {
  test('classement par importeurs directs décroissant, zéro importeur exclu', async () => {
    const r = await mapHot(root);
    expect(norm(r.files[0]!.file)).toBe('src/core/store.ts');
    expect(r.files[0]!.importedBy).toBe(3);
    expect(r.files.every((f) => f.importedBy > 0)).toBe(true);
  });
});

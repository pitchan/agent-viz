// D6 — le marqueur ESM de `dist/engine/` est un invariant CONTROLE, pas une
// bonne intention. Avant l'etape 2, `netgain/package.json` etait un fichier
// VERSIONNE : sa presence allait de soi. Apres, il est genere et git-ignore, et
// un `dist/engine/` sans lui est un dist qui ne se charge pas — alors que les
// deux fichiers historiques de `REQUIRED_DIST` y sont. Sans les deux tests
// ci-dessous, `netgain status` repondrait ON sur une installation morte.
//
// Fichier NEUF a dessein : `paths.test.ts` est l'un des 113 fichiers existants.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { missingDistFiles } from '../../src/engine/install/paths.js';

const scratch = mkdtempSync(path.join(tmpdir(), 'netgain-dist-marker-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe('REQUIRED_DIST reclame le marqueur ESM', () => {
  test('un dist/engine portant cli.js et mcp/main.js mais pas package.json reste incomplet', () => {
    mkdirSync(path.join(scratch, 'dist', 'engine', 'mcp'), { recursive: true });
    writeFileSync(path.join(scratch, 'dist', 'engine', 'cli.js'), '');
    writeFileSync(path.join(scratch, 'dist', 'engine', 'mcp', 'main.js'), '');
    expect(missingDistFiles(scratch)).toEqual(['dist/engine/package.json']);
  });
});

describe('le build appelle le poseur de marqueur', () => {
  // La propriete « apres un build, le marqueur est la » se scinde en deux
  // moities, toutes deux deja falsifiables, et AUCUNE n'exige de construire :
  //   1. le script `build` appelle bien le poseur de marqueur — ici ;
  //   2. le poseur ecrit bien `{"type":"module"}` — tests/unit/dist-esm-marker.test.mjs,
  //      contre un `dist/engine` fabrique dans os.tmpdir().
  // Ce qu'on ne prouve plus est nomme : que npm honore le `&&`. C'est le contrat
  // de npm, pas celui de ce depot, et le `npm run build` hors suite l'exerce.
  // Executer un vrai build ICI reecrirait les 87 fichiers de `dist/engine/` a
  // chaque execution de la suite — `tsc` n'est ni `incremental` ni `composite` —
  // pendant que sept fichiers de tests lisent ce meme dist, en parallele.
  test('le script build enchaine sur node scripts/dist-esm-marker.mjs', () => {
    const pkg = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as { scripts: Record<string, string> };
    expect(pkg.scripts['build']).toMatch(/&&\s*node\s+scripts\/dist-esm-marker\.mjs\s*$/);
  });
});

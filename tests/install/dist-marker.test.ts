// D6 — le marqueur ESM de `dist/engine/` est un invariant CONTROLE, pas une
// bonne intention. Avant l'etape 2, `netgain/package.json` etait un fichier
// VERSIONNE : sa presence allait de soi. Apres, il est genere et git-ignore, et
// un `dist/engine/` sans lui est un dist qui ne se charge pas — alors que les
// deux fichiers historiques de `REQUIRED_DIST` y sont. Sans les deux tests
// ci-dessous, `netgain status` repondrait ON sur une installation morte.
//
// Fichier NEUF a dessein : `paths.test.ts` est l'un des 113 fichiers existants.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { missingDistFiles, resolveNetgainRoot } from '../../src/engine/install/paths.js';

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

describe('le build ecrit le marqueur', () => {
  test('npm run build repose dist/engine/package.json a {"type":"module"}', () => {
    const racine = resolveNetgainRoot();
    const marqueur = path.join(racine, 'dist', 'engine', 'package.json');
    // Un TEMOIN plutot qu'une suppression : le marqueur reste valide pendant
    // tout le test, donc aucun autre fichier de test tournant en parallele ne
    // voit un `dist/engine/` incomplet. Si le build cesse d'ecrire le marqueur,
    // le temoin survit et ce test rougit.
    mkdirSync(path.dirname(marqueur), { recursive: true });
    writeFileSync(marqueur, JSON.stringify({ type: 'module', temoin: 'efface par le build' }));
    execFileSync('npm', ['run', 'build'], { cwd: racine, shell: true });
    expect(JSON.parse(readFileSync(marqueur, 'utf8'))).toEqual({ type: 'module' });
  }, 180_000);
});

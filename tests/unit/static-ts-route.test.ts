// Ce que ce fichier protège : un `.ts` servi garde EXACTEMENT les lignes de
// la source (piles d'erreur justes), et une syntaxe que Node ne sait pas
// effacer se dit — fichier, code d'erreur — jamais un 404 muet ou une page blanche.

// Même piège, même parade que dans version-route.test.ts : charger
// `src/server/routes` charge `session-index`, qui crée
// `os.tmpdir()/agent-events` dès sa lecture.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BAC = fs.mkdtempSync(path.join(os.tmpdir(), 'avtest-static-ts-'));
process.env.TEMP = BAC;
process.env.TMP = BAC;
process.env.TMPDIR = BAC;
process.env.USERPROFILE = BAC;
process.env.HOME = BAC;

import { afterAll, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';

const { readStaticFile } = await import('../../src/server/routes.ts');

afterAll(() => fs.rmSync(BAC, { recursive: true, force: true }));

const FIXTURES = path.join(__dirname, '..', 'fixtures', 'static-ts');
const VALIDE = path.join(FIXTURES, 'valid-sample.ts');
const ENUM = path.join(FIXTURES, 'unsupported-enum.ts');

test('.ts valide : Content-Type JS, corps compilable, meme nombre de lignes que la source', async () => {
  // Arrange
  const source = fs.readFileSync(VALIDE, 'utf8');

  // Act
  const { mime, body } = await readStaticFile(VALIDE);

  // Assert
  expect(mime).toBe('application/javascript; charset=utf-8');
  expect(body.toString('utf8').split('\n').length, 'le corps servi n a pas le meme nombre de lignes que la source : les numeros de ligne des erreurs navigateur mentiraient').toBe(source.split('\n').length);
  // .mjs et non .js : sans package.json dans le bac, Node 24 classe un .js
  // par detection et ne verifie RIEN si le corps ressemble a un module ES
  // (import/export) — un .js rendrait toujours exit 0 ici.
  const compilable = path.join(BAC, 'stripped.mjs');
  fs.writeFileSync(compilable, body);
  expect(
    () => execFileSync(process.execPath, ['--check', compilable], { stdio: 'pipe' }),
    'node --check refuse le corps servi',
  ).not.toThrow();
});

test('.ts avec syntaxe non effaçable : l erreur nomme le fichier et le code Node', async () => {
  // Arrange + Act + Assert — un seul comportement observable ici : le rejet.
  try {
    await readStaticFile(ENUM);
    expect.fail('devrait avoir rejete');
  } catch (err: any) {
    expect(err.message, 'le fichier fautif n est pas nomme dans le message').toMatch(/unsupported-enum\.ts/);
    expect(err.message, 'le code d erreur Node n apparait pas dans le message').toMatch(/ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX/);
  }
});

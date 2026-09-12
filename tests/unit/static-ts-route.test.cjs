'use strict';
// Ce que ce fichier protège : un `.ts` servi au navigateur garde EXACTEMENT
// les lignes de la source sur disque (les piles d'erreur du navigateur
// pointent juste), et une syntaxe que Node ne sait pas effacer se dit — nom
// du fichier, code d'erreur — au lieu de disparaître en 404 ou en page blanche.

// ── Le bac à sable, posé AVANT le premier require de `src/server/**` ─────────
// Même piège, même parade que dans version-route.test.cjs : charger
// `src/server/routes` charge `session-index`, qui crée
// `os.tmpdir()/agent-events` dès sa lecture.
const fs = require('fs');
const os = require('os');
const path = require('path');

const BAC = fs.mkdtempSync(path.join(os.tmpdir(), 'avtest-static-ts-'));
process.env.TEMP = BAC;
process.env.TMP = BAC;
process.env.TMPDIR = BAC;
process.env.USERPROFILE = BAC;
process.env.HOME = BAC;

const test = require('node:test');
const { after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

const { readStaticFile } = require('../../src/server/routes.ts');

after(() => fs.rmSync(BAC, { recursive: true, force: true }));

const FIXTURES = path.join(__dirname, '..', 'fixtures', 'static-ts');
const VALIDE = path.join(FIXTURES, 'valid-sample.ts');
const ENUM = path.join(FIXTURES, 'unsupported-enum.ts');

test('.ts valide : Content-Type JS, corps compilable, meme nombre de lignes que la source', async () => {
  // Arrange
  const source = fs.readFileSync(VALIDE, 'utf8');

  // Act
  const { mime, body } = await readStaticFile(VALIDE);

  // Assert
  assert.equal(mime, 'application/javascript; charset=utf-8');
  assert.equal(
    body.toString('utf8').split('\n').length,
    source.split('\n').length,
    'le corps servi n a pas le meme nombre de lignes que la source : les numeros de ligne des erreurs navigateur mentiraient',
  );
  const compilable = path.join(BAC, 'stripped.js');
  fs.writeFileSync(compilable, body);
  assert.doesNotThrow(
    () => execFileSync(process.execPath, ['--check', compilable], { stdio: 'pipe' }),
    'node --check refuse le corps servi',
  );
});

test('.ts avec syntaxe non effaçable : l erreur nomme le fichier et le code Node', async () => {
  // Arrange + Act + Assert — un seul comportement observable ici : le rejet.
  await assert.rejects(
    () => readStaticFile(ENUM),
    (err) => {
      assert.match(err.message, /unsupported-enum\.ts/, 'le fichier fautif n est pas nomme dans le message');
      assert.match(err.message, /ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX/, 'le code d erreur Node n apparait pas dans le message');
      return true;
    },
  );
});

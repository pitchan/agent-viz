'use strict';
// Ce que ce fichier protege : le demon dit QUELLE version il fait tourner.
// Identifier ce que sert un demon est une douleur mesuree du projet (un demon
// survivant sert l'ancien code sans que le binaire le dise) ; `GET /version`
// est la reponse par HTTP — la seule preuve d'instrument qui vaille ici.

// ── Le bac a sable, pose AVANT le premier require de `src/server/**` ─────────
// Meme piege, meme parade que dans watchdog-routes.test.cjs : charger
// `src/server/routes` charge `session-index`, qui cree
// `os.tmpdir()/agent-events` des sa lecture. `os.tmpdir()` et `os.homedir()`
// relisent l'environnement a chaque appel, et `node --test` donne un processus
// par fichier — les detourner ici suffit.
const fs = require('fs');
const os = require('os');
const path = require('path');

const BAC = fs.mkdtempSync(path.join(os.tmpdir(), 'avtest-version-'));
process.env.TEMP = BAC;
process.env.TMP = BAC;
process.env.TMPDIR = BAC;
process.env.USERPROFILE = BAC;
process.env.HOME = BAC;

const test = require('node:test');
const { after } = require('node:test');
const assert = require('node:assert/strict');

const { DIR } = require('../../src/server/session-index.ts');
const { ROUTES } = require('../../src/server/routes.ts');
const { version: versionDuPaquet } = require('../../package.json');

after(() => fs.rmSync(BAC, { recursive: true, force: true }));

// La redirection est verifiee, pas supposee : si elle ne prenait pas, tout ce
// fichier travaillerait sur les vraies donnees de l'utilisateur en silence.
test('bac a sable: pas le vrai dossier d evenements', () => {
  assert.ok(DIR.startsWith(BAC), `dossier d evenements hors du bac : ${DIR}`);
});

function fakeRes() {
  return {
    code: null, headers: null, body: null,
    writeHead(c, h) { this.code = c; this.headers = h; },
    end(b) { this.body = b; },
    json() { return JSON.parse(this.body); },
  };
}

const routeVersion = () =>
  ROUTES.find(r => r.method === 'GET' && r.path === '/version');

test('la table declare GET /version', () => {
  assert.ok(routeVersion(), 'aucune route GET /version dans ROUTES');
});

test('/version repond la version du paquet, en JSON', () => {
  // Arrange
  const res = fakeRes();
  // Act
  routeVersion().handler(null, res, null);
  // Assert
  assert.equal(res.code, 200);
  assert.match(res.headers['Content-Type'], /application\/json/);
  assert.deepEqual(res.json(), { version: versionDuPaquet });
});

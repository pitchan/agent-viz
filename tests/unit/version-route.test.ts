// Ce que ce fichier protege : le demon dit QUELLE version il fait tourner.
// Identifier ce que sert un demon est une douleur mesuree du projet (un demon
// survivant sert l'ancien code sans que le binaire le dise) ; `GET /version`
// est la reponse par HTTP — la seule preuve d'instrument qui vaille ici.

// ── Le bac a sable, pose AVANT le premier import de `src/server/**` ─────────
// Meme piege, meme parade que dans watchdog-routes.test.ts : charger
// `src/server/routes` charge `session-index`, qui cree
// `os.tmpdir()/agent-events` des sa lecture. `os.tmpdir()` et `os.homedir()`
// relisent l'environnement a chaque appel. Un import statique de ces deux
// modules s'evaluerait avant ces lignes (les imports sont hisses en tete) ;
// l'import dynamique plus bas s'assure qu'ils lisent APRES cette redirection.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, expect, test } from 'vitest';
import pkg from '../../package.json' with { type: 'json' };

const BAC = fs.mkdtempSync(path.join(os.tmpdir(), 'avtest-version-'));
process.env.TEMP = BAC;
process.env.TMP = BAC;
process.env.TMPDIR = BAC;
process.env.USERPROFILE = BAC;
process.env.HOME = BAC;

const { DIR } = await import('../../src/server/session-index.ts');
const { ROUTES } = await import('../../src/server/routes.ts');
const versionDuPaquet = pkg.version;

afterAll(() => fs.rmSync(BAC, { recursive: true, force: true }));

// La redirection est verifiee, pas supposee : si elle ne prenait pas, tout ce
// fichier travaillerait sur les vraies donnees de l'utilisateur en silence.
test('bac a sable: pas le vrai dossier d evenements', () => {
  expect(DIR.startsWith(BAC), `dossier d evenements hors du bac : ${DIR}`).toBeTruthy();
});

function fakeRes() {
  return {
    code: null as number | null,
    headers: null as Record<string, string> | null,
    body: null as string | null,
    writeHead(c: number, h: Record<string, string>) { this.code = c; this.headers = h; },
    end(b: string) { this.body = b; },
    json() { return JSON.parse(this.body!); },
  };
}

const routeVersion = () =>
  ROUTES.find(r => r.method === 'GET' && r.path === '/version');

test('la table declare GET /version', () => {
  expect(routeVersion(), 'aucune route GET /version dans ROUTES').toBeTruthy();
});

test('/version repond la version du paquet, en JSON', () => {
  // Arrange
  const res = fakeRes();
  // Act
  routeVersion()!.handler(null as any, res as any, null as any);
  // Assert
  expect(res.code).toBe(200);
  expect(res.headers!['Content-Type']).toMatch(/application\/json/);
  expect(res.json()).toEqual({ version: versionDuPaquet });
});

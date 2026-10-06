// Ce que ce fichier protege : le serveur ne repond qu'a son propre nom.
// Un site tiers qui fait pointer SON nom de domaine vers 127.0.0.1 obtient du
// navigateur des requetes « meme origine » ; l'en-tete Host porte alors ce nom.

// ── Le bac a sable, pose AVANT le premier import de `src/server/**` ─────────
// Meme piege, meme parade que dans version-route.test.ts : charger
// `src/server/routes` cree `os.tmpdir()/agent-events` des sa lecture.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterAll, expect, test } from 'vitest';

const BAC = fs.mkdtempSync(path.join(os.tmpdir(), 'avtest-host-'));
process.env.TEMP = BAC;
process.env.TMP = BAC;
process.env.TMPDIR = BAC;
process.env.USERPROFILE = BAC;
process.env.HOME = BAC;

const { DIR } = await import('../../src/server/session-index.ts');
const { dispatch } = await import('../../src/server/routes.ts');

afterAll(() => fs.rmSync(BAC, { recursive: true, force: true }));

test('bac a sable: pas le vrai dossier d evenements', () => {
  expect(DIR.startsWith(BAC), `dossier d evenements hors du bac : ${DIR}`).toBeTruthy();
});

function fakeRes() {
  return {
    code: null as number | null,
    writeHead(c: number) { this.code = c; },
    end() {},
  };
}

// GET /version : une route sans effet, qui repond 200 a qui a le droit de lire.
async function codePour(headers: Record<string, string>) {
  const res = fakeRes();
  await dispatch(
    { url: '/version', method: 'GET', headers } as unknown as IncomingMessage,
    res as unknown as ServerResponse,
  );
  return res.code;
}

test('un Host etranger est refuse, meme sur une lecture', async () => {
  expect(await codePour({ host: 'evil.example:3333' })).toBe(403);
});

test('un Host qui commence par localhost sans l etre est refuse', async () => {
  expect(await codePour({ host: 'localhost.evil.example:3333' })).toBe(403);
});

test('localhost est servi', async () => {
  expect(await codePour({ host: 'localhost:3333' })).toBe(200);
});

test('127.0.0.1 est servi, quelle que soit la casse ou le port', async () => {
  expect(await codePour({ host: '127.0.0.1:4000' })).toBe(200);
});

test('LOCALHOST en majuscules est servi : un nom d hote ignore la casse', async () => {
  expect(await codePour({ host: 'LOCALHOST:3333' })).toBe(200);
});

test('sans en-tete Host la requete passe : seul un navigateur peut etre detourne, et il en envoie toujours un', async () => {
  expect(await codePour({})).toBe(200);
});

// Ce que ce fichier protege : POST /notify ne sert que le hook. Il n'y envoie
// qu'un identifiant de session, sans en-tete Origin : un corps sans borne ou
// un appel venu d'un autre site sont refuses.

// ── Le bac a sable, pose AVANT le premier import de `src/server/**` ─────────
// Meme piege, meme parade que dans version-route.test.ts : charger
// `src/server/routes` cree `os.tmpdir()/agent-events` des sa lecture.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterAll, expect, test } from 'vitest';

const BAC = fs.mkdtempSync(path.join(os.tmpdir(), 'avtest-notify-'));
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

// Une requete de papier : `fire()` joue les morceaux du corps, puis la fin.
function fakeReq(headers: Record<string, string>, ...morceaux: Buffer[]) {
  const handlers: Record<string, ((arg?: unknown) => void) | undefined> = {};
  return {
    url: '/notify', method: 'POST', headers,
    on(ev: string, fn: (arg?: unknown) => void) { handlers[ev] = fn; return this; },
    async fire() {
      for (const m of morceaux) handlers.data?.(m);
      await handlers.end?.();
    },
  };
}

async function notifierDepuis(headers: Record<string, string>, ...morceaux: Buffer[]) {
  const res = fakeRes();
  const req = fakeReq(headers, ...morceaux);
  await dispatch(req as unknown as IncomingMessage, res as unknown as ServerResponse);
  await req.fire();
  return res.code;
}

const notifier = (...morceaux: Buffer[]) => notifierDepuis({}, ...morceaux);

test('une notification venue d un autre site est refusee en 405', async () => {
  // Arrange
  const corps = Buffer.from(JSON.stringify({ session: 'notify-origine-absente' }));
  // Act
  const code = await notifierDepuis({ origin: 'http://ailleurs.example' }, corps);
  // Assert
  expect(code).toBe(405);
});

test('un corps demesure est refuse en 413', async () => {
  // Arrange
  const megaoctet = Buffer.alloc(1024 * 1024, 'a');
  // Act
  const code = await notifier(megaoctet);
  // Assert
  expect(code).toBe(413);
});

test('un corps demesure arrive en petits morceaux est refuse aussi', async () => {
  // Arrange
  const morceaux = Array.from({ length: 1024 }, () => Buffer.alloc(1024, 'a'));
  // Act
  const code = await notifier(...morceaux);
  // Assert
  expect(code).toBe(413);
});

test('le corps que le hook envoie passe', async () => {
  // Arrange
  const corps = Buffer.from(JSON.stringify({ session: 'notify-limit-absente' }));
  // Act
  const code = await notifier(corps);
  // Assert
  expect(code).toBe(200);
});

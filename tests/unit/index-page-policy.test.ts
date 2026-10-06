// Ce que ce fichier protege : la page est servie avec une politique qui
// interdit au navigateur d'executer un script injecte ou de l'afficher dans le
// cadre d'un autre site — et la page elle-meme tient dans cette politique.

// ── Le bac a sable, pose AVANT le premier import de `src/server/**` ─────────
// Meme piege, meme parade que dans version-route.test.ts : charger
// `src/server/routes` cree `os.tmpdir()/agent-events` des sa lecture.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, expect, test } from 'vitest';

const BAC = fs.mkdtempSync(path.join(os.tmpdir(), 'avtest-page-'));
process.env.TEMP = BAC;
process.env.TMP = BAC;
process.env.TMPDIR = BAC;
process.env.USERPROFILE = BAC;
process.env.HOME = BAC;

const { DIR } = await import('../../src/server/session-index.ts');
const { ROUTES } = await import('../../src/server/routes.ts');

afterAll(() => fs.rmSync(BAC, { recursive: true, force: true }));

test('bac a sable: pas le vrai dossier d evenements', () => {
  expect(DIR.startsWith(BAC), `dossier d evenements hors du bac : ${DIR}`).toBeTruthy();
});

async function enTetesDeLaPage() {
  let headers: Record<string, string> = {};
  const res = {
    writeHead(_code: number, h: Record<string, string>) { headers = h; },
    end() {},
  };
  const page = ROUTES.find(r => r.method === 'GET' && r.path === '/');
  await page!.handler(null as any, res as any, null as any);
  return headers;
}

test('la page n autorise que les scripts servis par le serveur lui-meme', async () => {
  // Arrange
  const directives = (await enTetesDeLaPage())['Content-Security-Policy']!.split(';').map(d => d.trim());
  // Act
  const scripts = directives.find(d => d.startsWith('script-src'));
  // Assert
  expect(scripts).toBe("script-src 'self'");
});

test('la page refuse d etre affichee dans le cadre d un autre site', async () => {
  // Arrange
  const headers = await enTetesDeLaPage();
  // Act
  const cadre = headers['X-Frame-Options'];
  // Assert
  expect(cadre).toBe('DENY');
  expect(headers['Content-Security-Policy']).toContain("frame-ancestors 'none'");
});

test('index.html ne porte aucun script en ligne : la politique le bloquerait', () => {
  // Arrange
  const html = fs.readFileSync(path.join(import.meta.dirname, '..', '..', 'index.html'), 'utf8');
  // Act
  const scriptsEnLigne = [...html.matchAll(/<script\b[^>]*>/g)].map(m => m[0]).filter(b => !/\bsrc=/.test(b));
  // Assert
  expect(scriptsEnLigne).toEqual([]);
});

test('index.html ne porte aucun gestionnaire d evenement en attribut', () => {
  // Arrange
  const html = fs.readFileSync(path.join(import.meta.dirname, '..', '..', 'index.html'), 'utf8');
  // Act
  const gestionnaires = html.match(/\son[a-z]+\s*=/g) ?? [];
  // Assert
  expect(gestionnaires).toEqual([]);
});

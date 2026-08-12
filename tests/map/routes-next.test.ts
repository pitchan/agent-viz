import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { mapRoutes } from '../../src/engine/map/routes.js';

const root = mkdtempSync(path.join(tmpdir(), 'netgain-routes-next-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function fixture(rel: string, content: string): string {
  const p = path.join(root, rel);
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, content);
  return p;
}

// Forme umami exacte : export async function VERBE(...)
fixture(
  'src/app/api/me/route.ts',
  [
    "import { json } from '@/lib/response';",
    '',
    'export async function GET(request: Request) {',
    '  return json({});',
    '}',
    '',
  ].join('\n'),
);

// Plusieurs verbes dans le même fichier + forme export const
fixture(
  'src/app/api/boards/route.ts',
  [
    'export async function POST(request: Request) {',
    '  return new Response();',
    '}',
    '',
    'export const DELETE = async (request: Request) => new Response();',
    '',
  ].join('\n'),
);

// Segment dynamique [boardId] : conservé tel quel (forme native Next, rien d'inventé)
fixture(
  'src/app/api/boards/[boardId]/route.ts',
  ['export async function GET(request: Request) {', '  return new Response();', '}', ''].join('\n'),
);

// Ré-export nommé (forme wrapper, fréquente hors umami : dub etc.)
fixture(
  'src/app/api/batch/route.ts',
  ["import { handler } from './handler';", '', 'export { handler as POST };', ''].join('\n'),
);

// Groupe de routes (main) : retiré de l'URL ; page.tsx = navigation, method null
fixture(
  'src/app/(main)/dashboard/page.tsx',
  ['export default function DashboardPage() {', '  return null;', '}', ''].join('\n'),
);

// route.ts à la racine du dossier app (app/ direct, sans src/)
const rootApp = mkdtempSync(path.join(tmpdir(), 'netgain-routes-next-rootapp-'));
afterAll(() => rmSync(rootApp, { recursive: true, force: true }));
writeFileSync(
  path.join(mkdirSync(path.join(rootApp, 'app'), { recursive: true }) ?? path.join(rootApp, 'app'), 'route.ts'),
  ['export async function GET() {', '  return new Response();', '}', ''].join('\n'),
);

// Dossier privé _lib : hors routage Next, jamais une route
fixture(
  'src/app/api/_lib/route.ts',
  ['export async function GET() {', '  return new Response();', '}', ''].join('\n'),
);

// Faux positif 1 : route.ts HORS du dossier app → rien
fixture(
  'server/route.ts',
  ['export async function GET() {', '  return new Response();', '}', ''].join('\n'),
);

// Faux positif 2 : route.ts sous app/ SANS export de verbe HTTP (helper mal nommé) → rien
fixture(
  'src/app/api/helpers/route.ts',
  ['export function buildRoute(x: string) {', '  return x;', '}', ''].join('\n'),
);

// Faux positif 3 : page.tsx sans export default (pas une page Next valide) → rien
fixture(
  'src/app/broken/page.tsx',
  ['export function NotAPage() {', '  return null;', '}', ''].join('\n'),
);

describe('mapRoutes — Next app router, route.ts', () => {
  test('export async function GET → verbe + chemin dérivé de l’arborescence', async () => {
    const result = await mapRoutes(root);
    const me = result.routes.find((r) => r.framework === 'next' && r.path === '/api/me');
    expect(me).toMatchObject({
      method: 'GET',
      provenance: 'ast',
      guards: [],
      file: expect.stringContaining(path.join('api', 'me', 'route.ts')),
      line: 3,
    });
  });

  test('plusieurs verbes par fichier, y compris la forme export const', async () => {
    const result = await mapRoutes(root);
    const boards = result.routes.filter((r) => r.framework === 'next' && r.path === '/api/boards');
    expect(boards.map((r) => r.method).sort()).toEqual(['DELETE', 'POST']);
    const del = boards.find((r) => r.method === 'DELETE');
    expect(del?.line).toBe(5);
  });

  test('segment dynamique [boardId] conservé en forme native Next', async () => {
    const result = await mapRoutes(root);
    const byId = result.routes.find((r) => r.framework === 'next' && r.path === '/api/boards/[boardId]');
    expect(byId).toMatchObject({ method: 'GET' });
  });

  test('ré-export nommé (export { handler as POST }) détecté', async () => {
    const result = await mapRoutes(root);
    const batch = result.routes.find((r) => r.framework === 'next' && r.path === '/api/batch');
    expect(batch).toMatchObject({ method: 'POST' });
  });

  test('route.ts à la racine de app/ → chemin /', async () => {
    const result = await mapRoutes(rootApp);
    const home = result.routes.find((r) => r.framework === 'next' && r.path === '/');
    expect(home).toMatchObject({ method: 'GET' });
  });
});

describe('mapRoutes — Next app router, page.tsx', () => {
  test('page avec export default → route de navigation, method null, groupe (main) retiré de l’URL', async () => {
    const result = await mapRoutes(root);
    const dash = result.routes.find((r) => r.framework === 'next' && r.path === '/dashboard');
    expect(dash).toMatchObject({ method: null, file: expect.stringContaining('page.tsx') });
  });

  test('page sans export default → pas une page Next, rien', async () => {
    const result = await mapRoutes(root);
    expect(result.routes.find((r) => r.framework === 'next' && r.path === '/broken')).toBeUndefined();
  });
});

describe('mapRoutes — Next, garde-fous anti-faux-positifs', () => {
  test('dossier privé _lib : hors routage, jamais une route', async () => {
    const result = await mapRoutes(root);
    expect(result.routes.find((r) => r.framework === 'next' && r.path.includes('_lib'))).toBeUndefined();
    expect(result.routes.find((r) => r.framework === 'next' && r.path === '/api/_lib')).toBeUndefined();
  });

  test('route.ts hors du dossier app → rien', async () => {
    const result = await mapRoutes(root);
    expect(result.routes.filter((r) => r.framework === 'next' && r.file.startsWith('server'))).toEqual([]);
  });

  test('route.ts sans export de verbe HTTP → rien', async () => {
    const result = await mapRoutes(root);
    expect(result.routes.find((r) => r.framework === 'next' && r.path === '/api/helpers')).toBeUndefined();
  });
});

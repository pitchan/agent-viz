import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { mapRoutes } from '../../src/engine/map/routes.js';

const root = mkdtempSync(path.join(tmpdir(), 'netgain-routes-this-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function fixture(rel: string, content: string): string {
  const p = path.join(root, rel);
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, content);
  return p;
}

// Forme ApiServer (grist) : propriété de paramètre typée express.Application
fixture(
  'grist/api-server.ts',
  [
    "import * as express from 'express';",
    '',
    'export class ApiServer {',
    '  constructor(private _app: express.Application) {',
    '    this._addEndpoints();',
    '  }',
    '  private _addEndpoints() {',
    "    this._app.get('/api/orgs', (req, res) => res.json([]));",
    "    this._app.post('/api/orgs/:oid', (req, res) => res.json({}));",
    '  }',
    '}',
    '',
  ].join('\n'),
);

// Forme DocApi (grist) : import nommé Application + faux positif Map.get
fixture(
  'grist/doc-api.ts',
  [
    "import { Application } from 'express';",
    '',
    'export class DocApi {',
    '  constructor(private _app: Application, private _tables: Map<string, string>) {}',
    '  addEndpoints() {',
    "    this._app.get('/api/docs/:docId', () => null);",
    "    this._tables.get('/api/docs/fake');",
    '  }',
    '}',
    '',
  ].join('\n'),
);

// Forme FlexServer (grist) : propriété typée ET assignée express() — UNE route, pas deux ; regex ignorée
fixture(
  'grist/flex-server.ts',
  [
    "import express from 'express';",
    '',
    'export class FlexServer {',
    '  public app: express.Express;',
    '  constructor() {',
    '    this.app = express();',
    '  }',
    '  addLandingPages() {',
    "    this.app.get('/status', (req, res) => res.send('ok'));",
    '    this.app.get(/^\\/test\\//, (req, res) => res.send(\'no\'));',
    '  }',
    '}',
    '',
  ].join('\n'),
);

// Fichier qui importe express MAIS receveur lié à sqlite : jamais une route
fixture(
  'grist/history.ts',
  [
    "import { Application } from 'express';",
    "import { Database } from 'sqlite3';",
    '',
    'export class HistoryImpl {',
    '  constructor(private _db: Database, private _app: Application) {}',
    '  load() {',
    "    this._db.all('SELECT 1');",
    "    this._db.get('/not/a/route');",
    '  }',
    '}',
    '',
  ].join('\n'),
);

// Propriété typée Router (import renommé) : chemin local, mountedAt unknown
fixture(
  'grist/router-prop.ts',
  [
    "import { Router as ApiRouter } from 'express';",
    '',
    'export class DocsApi {',
    '  constructor(private _api: ApiRouter) {}',
    '  attach() {',
    "    this._api.get('/docs', () => null);",
    '  }',
    '}',
    '',
  ].join('\n'),
);

// Liaison PAR CLASSE : même nom de propriété, seule la classe liée compte
fixture(
  'grist/two-classes.ts',
  [
    "import { Application } from 'express';",
    '',
    'export class Bound {',
    '  constructor(private _app: Application) {}',
    "  add() { this._app.get('/bound', () => null); }",
    '}',
    '',
    'export class Unbound {',
    '  constructor(private _app: Map<string, string>) {}',
    "  add() { this._app.get('/unbound', () => null); }",
    '}',
    '',
  ].join('\n'),
);

// Propriété réassignée après express() : liaison perdue, rien (patron J1-fix2 : assignée UNE fois)
fixture(
  'grist/flaky.ts',
  [
    "import express from 'express';",
    '',
    'export class Flaky {',
    '  private srv;',
    '  constructor(alt) {',
    '    this.srv = express();',
    '    this.srv = alt;',
    '  }',
    "  add() { this.srv.get('/flaky', () => null); }",
    '}',
    '',
  ].join('\n'),
);

// Forme attachEarlyEndpoints (grist) : paramètre de fonction typé, liste multi-ligne
fixture(
  'grist/attach-endpoints.ts',
  [
    "import { Application } from 'express';",
    '',
    'export function attachEarlyEndpoints(',
    '  server: unknown,',
    '  app: Application,',
    ') {',
    "  app.get('/early', () => null);",
    '}',
    '',
  ].join('\n'),
);

// Forme Housekeeper (grist) : paramètre de méthode typé qualifié
fixture(
  'grist/housekeeper.ts',
  [
    "import * as express from 'express';",
    '',
    'export class Housekeeper {',
    '  public addEndpoints(app: express.Application) {',
    "    app.post('/housekeeping/docs/:docId', () => null);",
    '  }',
    '}',
    '',
  ].join('\n'),
);

// Portée lexicale : même nom de paramètre, seule la fonction au type express compte ;
// et un commentaire contenant app.get('/fake') ne produit jamais une route (AST, pas grep)
fixture(
  'grist/scoped-params.ts',
  [
    "import { Application } from 'express';",
    '',
    "// Use app.get('/fake', handler) to serve something",
    'export function bound(app: Application) {',
    "  app.get('/param-bound', () => null);",
    '}',
    '',
    'export function notBound(app: { get(k: string, h: unknown): void }) {',
    "  app.get('/param-unbound', () => null);",
    '}',
    '',
  ].join('\n'),
);

// Paramètre de fonction fléchée typé
fixture(
  'grist/arrow-attach.ts',
  [
    "import { Application } from 'express';",
    '',
    'export const attach = (app: Application) => {',
    "  app.delete('/arrow', () => null);",
    '};',
    '',
  ].join('\n'),
);

// Forme attachAppEndpoint (grist) : options typées par interface du MÊME fichier,
// destructurées en const — et premier argument TABLEAU de chemins
fixture(
  'grist/app-endpoint.ts',
  [
    "import * as express from 'express';",
    '',
    'export interface AttachOptions {',
    '  app: express.Application;',
    '  middleware: express.RequestHandler[];',
    '}',
    '',
    'export function attachAppEndpoint(options: AttachOptions): void {',
    '  const { app, middleware } = options;',
    "  app.get(['/', '/ws/:wsId'], () => null);",
    "  app.get('/attached', () => null);",
    '}',
    '',
  ].join('\n'),
);

// Destructuration avec renommage + type membre nu (import nommé)
fixture(
  'grist/early-endpoints.ts',
  [
    "import { Application } from 'express';",
    '',
    'interface EarlyOptions {',
    '  app: Application;',
    '  label: string;',
    '}',
    '',
    'export function attachEarly(options: EarlyOptions) {',
    '  const { app: earlyApp, label } = options;',
    "  earlyApp.post('/early-renamed', () => null);",
    "  label.at(0);",
    '}',
    '',
  ].join('\n'),
);

// Frontière : interface importée d’un autre fichier → aveuglement honnête, rien
fixture(
  'grist/imported-options.ts',
  [
    "import express from 'express';",
    "import { RemoteOptions } from './types';",
    '',
    'export function attachRemote(options: RemoteOptions) {',
    '  const { app } = options;',
    "  app.get('/remote-blind', () => null);",
    '}',
    '',
  ].join('\n'),
);

// Garde : membre destructuré NON typé express → rien
fixture(
  'grist/non-express-member.ts',
  [
    "import { Application } from 'express';",
    '',
    'interface StoreOptions {',
    '  store: Map<string, string>;',
    '  app: Application;',
    '}',
    '',
    'export function load(options: StoreOptions) {',
    '  const { store } = options;',
    "  store.get('/store-key');",
    '}',
    '',
  ].join('\n'),
);

describe('mapRoutes — Express, options destructurées typées par interface locale', () => {
  test('const { app } = options (interface du même fichier) → routes détectées', async () => {
    const result = await mapRoutes(root);
    expect(result.routes.find((r) => r.path === '/attached')).toMatchObject({ method: 'GET', framework: 'express', mountedAt: null });
  });

  test('premier argument tableau de chemins → un fait par chemin, rien d’inventé', async () => {
    const result = await mapRoutes(root);
    expect(result.routes.find((r) => r.path === '/' && r.framework === 'express')).toMatchObject({ method: 'GET' });
    expect(result.routes.find((r) => r.path === '/ws/:wsId')).toMatchObject({ method: 'GET' });
  });

  test('destructuration renommée (app: earlyApp) → détectée sous le nom local', async () => {
    const result = await mapRoutes(root);
    expect(result.routes.find((r) => r.path === '/early-renamed')).toMatchObject({ method: 'POST' });
  });

  test('interface importée d’un autre fichier → aveuglement honnête, rien', async () => {
    const result = await mapRoutes(root);
    expect(result.routes.find((r) => r.path === '/remote-blind')).toBeUndefined();
  });

  test('membre destructuré non-express (Map) → jamais une route', async () => {
    const result = await mapRoutes(root);
    expect(result.routes.find((r) => r.path === '/store-key')).toBeUndefined();
  });
});

describe('mapRoutes — Express, receveur paramètre typé express (généralisation J1-gén)', () => {
  test('paramètre de fonction typé Application (liste multi-ligne) → route détectée', async () => {
    const result = await mapRoutes(root);
    expect(result.routes.find((r) => r.path === '/early')).toMatchObject({ method: 'GET', framework: 'express', mountedAt: null });
  });

  test('paramètre de méthode typé express.Application → route détectée', async () => {
    const result = await mapRoutes(root);
    expect(result.routes.find((r) => r.path === '/housekeeping/docs/:docId')).toMatchObject({ method: 'POST' });
  });

  test('portée lexicale : même nom, seul le paramètre au type express produit une route', async () => {
    const result = await mapRoutes(root);
    expect(result.routes.find((r) => r.path === '/param-bound')).toMatchObject({ method: 'GET' });
    expect(result.routes.find((r) => r.path === '/param-unbound')).toBeUndefined();
  });

  test('app.get dans un commentaire : jamais une route (AST, pas grep)', async () => {
    const result = await mapRoutes(root);
    expect(result.routes.find((r) => r.path === '/fake')).toBeUndefined();
  });

  test('paramètre de fonction fléchée typé → route détectée', async () => {
    const result = await mapRoutes(root);
    expect(result.routes.find((r) => r.path === '/arrow')).toMatchObject({ method: 'DELETE' });
  });
});

describe('mapRoutes — Express, receveur this.propriété (patron J1-fix2)', () => {
  test('propriété de paramètre typée express.Application → routes complètes, mountedAt null', async () => {
    const result = await mapRoutes(root);
    const orgs = result.routes.find((r) => r.framework === 'express' && r.path === '/api/orgs');
    expect(orgs).toMatchObject({ method: 'GET', mountedAt: null, file: expect.stringContaining('api-server.ts'), line: 8 });
    const oid = result.routes.find((r) => r.framework === 'express' && r.path === '/api/orgs/:oid');
    expect(oid).toMatchObject({ method: 'POST' });
  });

  test('import nommé Application → détecté ; Map.get même avec chemin en argument → jamais', async () => {
    const result = await mapRoutes(root);
    expect(result.routes.find((r) => r.path === '/api/docs/:docId')).toMatchObject({ method: 'GET', framework: 'express' });
    expect(result.routes.find((r) => r.path === '/api/docs/fake')).toBeUndefined();
  });

  test('propriété typée ET assignée express() → UNE seule route, premier argument regex ignoré', async () => {
    const result = await mapRoutes(root);
    const status = result.routes.filter((r) => r.path === '/status');
    expect(status).toHaveLength(1);
    expect(status[0]).toMatchObject({ method: 'GET', mountedAt: null });
    expect(result.routes.filter((r) => r.file.includes('flex-server'))).toHaveLength(1);
  });

  test('receveur lié à autre chose (sqlite) dans un fichier qui importe express → rien', async () => {
    const result = await mapRoutes(root);
    expect(result.routes.filter((r) => r.file.includes('history.ts'))).toEqual([]);
  });

  test('propriété typée Router (import renommé) → chemin local, mountedAt unknown', async () => {
    const result = await mapRoutes(root);
    const docs = result.routes.find((r) => r.path === '/docs');
    expect(docs).toMatchObject({ method: 'GET', framework: 'express', mountedAt: 'unknown' });
  });

  test('liaison par classe : même nom de propriété, seule la classe liée produit une route', async () => {
    const result = await mapRoutes(root);
    expect(result.routes.find((r) => r.path === '/bound')).toMatchObject({ method: 'GET' });
    expect(result.routes.find((r) => r.path === '/unbound')).toBeUndefined();
  });

  test('propriété réassignée après express() : liaison perdue, rien', async () => {
    const result = await mapRoutes(root);
    expect(result.routes.find((r) => r.path === '/flaky')).toBeUndefined();
  });
});

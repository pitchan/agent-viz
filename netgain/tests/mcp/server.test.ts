import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { createMapServer } from '../../src/mcp/server.js';

const root = mkdtempSync(path.join(tmpdir(), 'netgain-mcp-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function fixture(rel: string, content: string): string {
  const p = path.join(root, rel);
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, content);
  return p;
}

fixture(
  'src/api.controller.ts',
  [
    "import { Controller, Get } from '@nestjs/common';",
    "import { store } from './store';",
    '',
    "@Controller('api')",
    'export class ApiController {',
    ...Array.from({ length: 40 }, (_, i) => [`  @Get('resource-${String(i).padStart(2, '0')}')`, `  m${i}() { return ${i}; }`]).flat(),
    '}',
    '',
  ].join('\n'),
);

fixture('src/env.ts', 'if (!process.env.MAP_TEST_SECRET) {\n  throw new Error("manquant");\n}\n');

// Graphe : store importé par le contrôleur + 80 fichiers → la liste des
// dépendants doit être coupée par le budget de 2 Ko.
fixture('src/store.ts', 'export const store = 1;\n');
for (let i = 0; i < 80; i++) {
  fixture(`src/imp${String(i).padStart(2, '0')}.ts`, `import { store } from './store';\nexport const v${i} = store;\n`);
}

const server = createMapServer({ defaultRoot: root });
const rpc = (method: string, params?: unknown, id: number | null = 1) =>
  server.handle({ jsonrpc: '2.0', id, method, ...(params !== undefined ? { params } : {}) });

describe('serveur MCP map — protocole', () => {
  test('initialize : écho du protocolVersion client, capacité tools, serverInfo', async () => {
    const res = (await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'x', version: '0' } })) as {
      result: { protocolVersion: string; capabilities: { tools: object }; serverInfo: { name: string; version: string } };
    };
    expect(res.result.protocolVersion).toBe('2025-06-18');
    expect(res.result.capabilities.tools).toBeDefined();
    expect(res.result.serverInfo.name).toBe('netgain-map');
    // Un seul outil, une seule version : celle du package.json du produit, à la
    // racine du dépôt (le moteur n'est plus un paquet distinct).
    const pkg = JSON.parse(readFileSync(path.resolve(import.meta.dirname, '..', '..', '..', 'package.json'), 'utf8')) as { version: string };
    expect(res.result.serverInfo.version).toBe(pkg.version);
  });

  test('notification (id absent) → aucune réponse', async () => {
    const res = await server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' });
    expect(res).toBeNull();
  });

  test('tools/list : les 6 outils, chacun avec description et inputSchema', async () => {
    const res = (await rpc('tools/list')) as { result: { tools: Array<{ name: string; description: string; inputSchema: object }> } };
    const names = res.result.tools.map((t) => t.name).sort();
    expect(names).toEqual(['map_env', 'map_health', 'map_hot', 'map_impact', 'map_orient', 'map_routes']);
    for (const tool of res.result.tools) {
      expect(tool.description.length).toBeGreaterThan(20);
      expect(tool.inputSchema).toMatchObject({ type: 'object' });
    }
  });

  test('méthode inconnue → erreur JSON-RPC -32601', async () => {
    const res = (await rpc('foo/bar')) as { error: { code: number } };
    expect(res.error.code).toBe(-32601);
  });
});

describe('serveur MCP map — tools/call', () => {
  test('map_routes : réponse texte JSON ≤ 2 Ko avec coupe annotée', async () => {
    const res = (await rpc('tools/call', { name: 'map_routes', arguments: {} })) as {
      result: { content: Array<{ type: string; text: string }>; isError?: boolean };
    };
    expect(res.result.isError).toBeUndefined();
    const body = JSON.parse(res.result.content[0]!.text) as { routes: unknown[]; total: number; omitted: number; note?: string };
    expect(Buffer.byteLength(res.result.content[0]!.text, 'utf8')).toBeLessThanOrEqual(2048);
    expect(body.total).toBe(40);
    expect(body.omitted).toBeGreaterThan(0);
    expect(body.note).toBe(`+${body.omitted} omitted`);
  });

  test('map_routes avec offset pagine', async () => {
    const page1 = (await rpc('tools/call', { name: 'map_routes', arguments: {} })) as { result: { content: Array<{ text: string }> } };
    const n1 = (JSON.parse(page1.result.content[0]!.text) as { routes: unknown[] }).routes.length;
    const page2 = (await rpc('tools/call', { name: 'map_routes', arguments: { offset: n1 } })) as { result: { content: Array<{ text: string }> } };
    const body2 = JSON.parse(page2.result.content[0]!.text) as { routes: Array<{ path: string }> };
    expect(body2.routes[0]?.path).not.toBe('/api/resource-00');
  });

  test('map_env : le throw-guard ressort en required', async () => {
    const res = (await rpc('tools/call', { name: 'map_env', arguments: {} })) as { result: { content: Array<{ text: string }> } };
    const body = JSON.parse(res.result.content[0]!.text) as { env: Array<{ name: string; required: boolean | string }> };
    expect(body.env.find((f) => f.name === 'MAP_TEST_SECRET')).toMatchObject({ required: true });
  });

  test('outil inconnu → isError true, message honnête', async () => {
    const res = (await rpc('tools/call', { name: 'map_blast', arguments: {} })) as {
      result: { isError: boolean; content: Array<{ text: string }> };
    };
    expect(res.result.isError).toBe(true);
    expect(res.result.content[0]!.text).toContain('map_blast');
  });

  test('map_impact : blast radius chiffré, routes impactées, budget ≤ 2 Ko avec coupe annotée', async () => {
    const res = (await rpc('tools/call', { name: 'map_impact', arguments: { target: 'src/store.ts' } })) as {
      result: { content: Array<{ text: string }>; isError?: boolean };
    };
    expect(res.result.isError).toBeUndefined();
    const text = res.result.content[0]!.text;
    expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(2048);
    const body = JSON.parse(text) as {
      target: string;
      direct: number;
      transitive: number;
      routesImpacted: number;
      dependents: unknown[];
      total: number;
      omitted: number;
      note?: string;
    };
    expect(body.direct).toBe(81);
    expect(body.transitive).toBe(81);
    expect(body.routesImpacted).toBe(40);
    expect(body.total).toBe(81);
    expect(body.omitted).toBeGreaterThan(0);
    expect(body.note).toBe(`+${body.omitted} omitted`);
  });

  test('map_impact sans target ou cible inconnue → isError honnête', async () => {
    const missing = (await rpc('tools/call', { name: 'map_impact', arguments: {} })) as {
      result: { isError?: boolean; content: Array<{ text: string }> };
    };
    expect(missing.result.isError).toBe(true);
    const unknown = (await rpc('tools/call', { name: 'map_impact', arguments: { target: 'src/nope.ts' } })) as {
      result: { isError?: boolean; content: Array<{ text: string }> };
    };
    expect(unknown.result.isError).toBe(true);
    expect(unknown.result.content[0]!.text).toContain('nope');
  });

  test('map_hot : classement des plus importés, budget respecté', async () => {
    const res = (await rpc('tools/call', { name: 'map_hot', arguments: {} })) as {
      result: { content: Array<{ text: string }>; isError?: boolean };
    };
    expect(res.result.isError).toBeUndefined();
    const body = JSON.parse(res.result.content[0]!.text) as { files: Array<{ file: string; importedBy: number }> };
    expect(body.files[0]!.file.replaceAll('\\', '/')).toBe('src/store.ts');
    expect(body.files[0]!.importedBy).toBe(81);
  });
});

describe('descriptions d’outils — livrable §2.1, corrigé post-J5', () => {
  const getDescriptions = async (): Promise<Map<string, string>> => {
    const res = (await rpc('tools/list')) as { result: { tools: Array<{ name: string; description: string }> } };
    return new Map(res.result.tools.map((t) => [t.name, t.description]));
  };

  test('map_routes porte l’affordance NÉGATIVE : énumérer = Grep de l’hôte moins cher, n’appeler qu’en jointure avec le graphe (le piège S11)', async () => {
    const desc = (await getDescriptions()).get('map_routes')!;
    expect(desc).toMatch(/Grep/);
    expect(desc).toMatch(/moins cher/i);
    expect(desc).toMatch(/jointure avec le graphe/i);
  });

  test('map_routes garde son contenu factuel (guards, file:line)', async () => {
    const desc = (await getDescriptions()).get('map_routes')!;
    expect(desc).toMatch(/guards/i);
    expect(desc).toMatch(/file:line/i);
  });

  test('map_impact et map_hot restent des affordances POSITIVES (aucune mise en garde d’énumération)', async () => {
    const descs = await getDescriptions();
    expect(descs.get('map_impact')).not.toMatch(/moins cher/i);
    expect(descs.get('map_hot')).not.toMatch(/moins cher/i);
  });
});

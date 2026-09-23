// The twelve analysis endpoints: response shapes, guards, and the answer to a
// failing service. The service is injected, so no SQLite file and no engine
// are needed.

import { expect, test } from 'vitest';
import { createObservatoryRoutes } from '../../src/server/observatory/routes.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';

// Service (routes.ts) n'est pas exporte : c'est le type de retour du service
// reel, injecte ici sans jamais importer service.ts (qui ouvrirait SQLite).
type Service = ReturnType<Parameters<typeof createObservatoryRoutes>[0]>;

function mockRes() {
  return {
    statusCode: null as number | null, headers: null as Record<string, string> | null, body: '',
    writeHead(code: number, headers?: Record<string, string>) { this.statusCode = code; this.headers = headers || null; },
    end(data?: string) { this.body = data || ''; },
  };
}

// Double de service : chaque test ne remplace que les methodes qu'il observe,
// donc les parametres des methodes de remplacement restent `any` — seule la
// forme observee (via `got`) compte, jamais le contrat complet du service reel.
const SERVICE = {
  summary: async () => ({ sessions: 3, netTokens: 1000, costUsd: 2, costComplete: true,
    cacheReadTokens: 500, anomalies: { parseErrors: 0, partialCostSessions: 0 },
    lastScanAt: '2026-07-15T12:00:00.000Z' }),
  sessions: async () => [{ id: 's1', project: 'F--proj', costUsd: 1 }],
  session: async (id: string) => (id === 's1' ? { id: 's1', report: { sessionId: 's1' } } : null),
  scan: async () => ({ discovered: 2, scanned: 2, skipped: 0, failed: 0 }),
  purge: async () => {},
  configAudit: async () => ({ items: [{ kind: 'mcp', name: 'x', scope: 'user', detail: {} }],
    usage: { x: { calls: 0, sessions: 0 } }, sessions: 3 }),
  recommendations: async () => ({ groups: [{ basis: 'jetons-mesures', priority: [{ id: 1 }], all: [{ id: 1 }] }],
    stale: [] }),
  setRecommendationStatus: async (id: number, status: string) => id === 1 && status === 'ignored',
  modelCosts: async () => ({
    models: [{ model: 'claude-opus-4-8', costUsd: 1, pricing: 'tarife' }],
    totals: { netTokens: 10, costUsd: 1, costComplete: true, cacheReadTokens: 0 },
    unknownModels: [], excludedPendingRescan: 0, basis: null, period: null,
  }),
  skillUsage: async () => ({
    skills: [{ skill: 'pptx', offeredSessions: 2, usedSessions: 1, usedShare: 0.5 }],
    sessionsCounted: 2, excludedPendingRescan: 0, basis: null, period: null,
    projects: [{ project: 'F--dvf', label: 'F:/DEV/dvf', sessions: 2 }],
  }),
  pricing: async () => ({
    priceTable: { source: 'netgain-table-embarquee', unit: 'usd-par-jeton', entries: [], zeroCost: [] },
    provenance: { scanVersion: 6, engineVersion: '0.13.0', priceSource: 'netgain-table-embarquee', sections: [] },
    engineVersion: '0.13.0', scanVersion: 6,
  }),
} as unknown as Service;

function router(service = SERVICE) {
  const routes = createObservatoryRoutes(() => service);
  return async (method: string, url: string) => {
    const u = new URL(url, 'http://localhost');
    const route = routes.find(r =>
      r.method === method && (r.path === u.pathname || (r.prefix && u.pathname.startsWith(r.prefix))));
    expect(route, `no route for ${method} ${url}`).toBeTruthy();
    const res = mockRes();
    await route!.handler({ method, url, headers: {} } as unknown as IncomingMessage, res as unknown as ServerResponse, u);
    return res;
  };
}

test('the twelve analysis routes are declared with their methods', () => {
  const declared = createObservatoryRoutes(() => SERVICE)
    .map(r => `${r.method} ${r.path || r.prefix}`).sort();
  expect(declared).toEqual([
    'GET /analysis/models', 'GET /analysis/session/', 'GET /analysis/sessions',
    'GET /analysis/skills', 'GET /analysis/summary', 'GET /config/audit', 'GET /pricing', 'GET /recommendations',
    'POST /analysis/purge', 'POST /analysis/scan', 'POST /pricing/adopt', 'POST /recommendations/',
  ]);
});

test('mutating routes are guarded by sameOrigin', () => {
  const guarded = createObservatoryRoutes(() => SERVICE)
    .filter(r => r.sameOrigin).map(r => r.path || r.prefix).sort();
  expect(guarded).toEqual(['/analysis/purge', '/analysis/scan', '/pricing/adopt', '/recommendations/']);
});

test('GET /analysis/summary returns the period totals and names its price source', async () => {
  const res = await router()('GET', '/analysis/summary');
  expect(res.statusCode).toBe(200);
  const body = JSON.parse(res.body);
  expect(body.sessions).toBe(3);
  expect(body.costComplete).toBe(true);
  expect(body.priceSource).toBe('netgain-table-embarquee');
});

test('GET /analysis/summary forwards days and includeMachine to the service', async () => {
  let got;
  const spy = { ...SERVICE, summary: async (opts: any) => { got = opts; return {}; } } as unknown as Service;
  await router(spy)('GET', '/analysis/summary?days=7&includeMachine=1');
  expect(got).toEqual({ days: 7, includeMachine: true });
});

test('an absent or non-numeric days parameter reaches the service as undefined', async () => {
  let got;
  const spy = { ...SERVICE, summary: async (opts: any) => { got = opts; return {}; } } as unknown as Service;
  await router(spy)('GET', '/analysis/summary?days=abc');
  expect(got).toEqual({ days: undefined, includeMachine: false });
});

test('GET /analysis/sessions returns the analytic list', async () => {
  const res = await router()('GET', '/analysis/sessions?project=F--proj');
  expect(res.statusCode).toBe(200);
  expect(JSON.parse(res.body).map((s: any) => s.id)).toEqual(['s1']);
});

test('GET /analysis/sessions forwards the window and the toggle', async () => {
  let got;
  const spy = { ...SERVICE, sessions: async (opts: any) => { got = opts; return []; } } as unknown as Service;
  await router(spy)('GET', '/analysis/sessions?project=F--p&days=90');
  expect(got).toEqual({ project: 'F--p', days: 90, includeMachine: false });
});

test('GET /analysis/session/:id returns the full report, 404 when unknown', async () => {
  const ok = await router()('GET', '/analysis/session/s1');
  expect(ok.statusCode).toBe(200);
  expect(JSON.parse(ok.body).report.sessionId).toBe('s1');
  expect((await router()('GET', '/analysis/session/nope')).statusCode).toBe(404);
});

test('GET /analysis/session/ with no id is a 400, not a crash', async () => {
  expect((await router()('GET', '/analysis/session/')).statusCode).toBe(400);
});

test('POST /analysis/scan answers immediately and does not wait for the scan', async () => {
  let resolveScan: (value: unknown) => void;
  const slow = { ...SERVICE, scan: () => new Promise(r => { resolveScan = r; }) } as unknown as Service;
  const res = await router(slow)('POST', '/analysis/scan');
  expect(res.statusCode).toBe(202);
  expect(JSON.parse(res.body).started).toBe(true);
  resolveScan!({ discovered: 0, scanned: 0, skipped: 0, failed: 0 });
});

test('POST /analysis/scan?days=7 passes the window, still answers 202 immediately', async () => {
  let got;
  const spy = { ...SERVICE, scan: async (opts: any) => { got = opts; } } as unknown as Service;
  const res = await router(spy)('POST', '/analysis/scan?days=7');
  expect(res.statusCode).toBe(202);
  expect(got).toEqual({ days: 7 });
});

test('GET /config/audit returns the inventory and its usage', async () => {
  const res = await router()('GET', '/config/audit');
  expect(res.statusCode).toBe(200);
  expect(JSON.parse(res.body).items.length).toBe(1);
});

test('GET /recommendations returns the groups and the stale list', async () => {
  const res = await router()('GET', '/recommendations');
  expect(res.statusCode).toBe(200);
  const body = JSON.parse(res.body);
  expect(body.groups[0].basis).toBe('jetons-mesures');
  expect(body.stale).toEqual([]);
});

test('POST /recommendations/:id accepts a known status, rejects anything else', async () => {
  const call = (id: number | string, status: string) => router()('POST', `/recommendations/${id}?status=${status}`);
  expect((await call(1, 'ignored')).statusCode).toBe(200);
  expect((await call(1, 'deleted')).statusCode).toBe(400);
  expect((await call(2, 'ignored')).statusCode).toBe(404);
  expect((await call('abc', 'ignored')).statusCode).toBe(400);
});

// ─── Statut « arbitré » : la raison entre par la même route ────────────────

test('POST arbitrated transmet la raison décodée au service', async () => {
  // Arrange
  let got;
  const spy = { ...SERVICE,
    setRecommendationStatus: async (id: number, status: string, reason: string | null) => { got = { id, status, reason }; return true; } } as unknown as Service;
  // Act
  const res = await router(spy)('POST',
    '/recommendations/1?status=arbitrated&reason=d%C3%A9j%C3%A0%20pes%C3%A9');
  // Assert
  expect(res.statusCode).toBe(200);
  expect(JSON.parse(res.body)).toEqual({ id: 1, status: 'arbitrated' });
  expect(got).toEqual({ id: 1, status: 'arbitrated', reason: 'déjà pesé' });
});

test('un arbitrage sans raison est un 400, avec le libellé exact', async () => {
  // Arrange — le service ne doit jamais être atteint.
  let called = false;
  const spy = { ...SERVICE, setRecommendationStatus: async () => { called = true; return true; } } as unknown as Service;
  // Act
  const res = await router(spy)('POST', '/recommendations/1?status=arbitrated');
  // Assert
  expect(res.statusCode).toBe(400);
  expect(JSON.parse(res.body).error).toBe('raison d’arbitrage manquante');
  expect(called).toBe(false);
});

test('une raison blanche vaut une raison absente', async () => {
  // Arrange
  // Act
  const res = await router()('POST', '/recommendations/1?status=arbitrated&reason=%20%20');
  // Assert
  expect(res.statusCode).toBe(400);
});

test('la raison ne voyage que pour un arbitrage — nulle pour les autres statuts', async () => {
  // Arrange
  let got;
  const spy = { ...SERVICE,
    setRecommendationStatus: async (id: number, status: string, reason: string | null) => { got = { id, status, reason }; return true; } } as unknown as Service;
  // Act
  await router(spy)('POST', '/recommendations/1?status=ignored&reason=parasite');
  // Assert
  expect(got).toEqual({ id: 1, status: 'ignored', reason: null });
});

test('une panne du service répond 500 avec son message exact', async () => {
  // Arrange
  const broken = {
    ...SERVICE,
    summary: async () => { throw new Error('database is locked'); },
  } as unknown as Service;
  // Act
  const res = await router(broken)('GET', '/analysis/summary');
  // Assert
  expect(res.statusCode).toBe(500);
  expect(JSON.parse(res.body)).toEqual({ error: 'database is locked' });
});

test('POST /analysis/purge wipes first, then starts a rebuild scan with the window', async () => {
  const events: unknown[] = [];
  const spy = {
    ...SERVICE,
    purge: async () => { events.push('purge'); },
    scan: async (opts: any) => { events.push(['scan', opts]); return {}; },
  } as unknown as Service;
  const res = await router(spy)('POST', '/analysis/purge?days=7');
  expect(res.statusCode).toBe(202);
  expect(JSON.parse(res.body)).toEqual({ purged: true, started: true });
  expect(events).toEqual(['purge', ['scan', { days: 7 }]]);
});

test('une purge qui échoue répond 500 et ne lance pas de scan', async () => {
  // Arrange
  let scanned = false;
  const spy = {
    ...SERVICE,
    purge: async () => { throw new Error('database is locked'); },
    scan: async () => { scanned = true; },
  } as unknown as Service;
  // Act
  const res = await router(spy)('POST', '/analysis/purge');
  // Assert
  expect(res.statusCode).toBe(500);
  expect(JSON.parse(res.body)).toEqual({ error: 'database is locked' });
  expect(scanned).toBe(false);
});

test('GET /analysis/models returns the breakdown and names its price source', async () => {
  const res = await router()('GET', '/analysis/models');
  expect(res.statusCode).toBe(200);
  const body = JSON.parse(res.body);
  expect(body.models[0].model).toBe('claude-opus-4-8');
  expect(body.totals.costUsd).toBe(1);
  expect(body.priceSource).toBe('netgain-table-embarquee');
});

test('GET /analysis/models forwards days and includeMachine to the service', async () => {
  let got;
  const spy = { ...SERVICE, modelCosts: async (opts: any) => { got = opts; return {}; } } as unknown as Service;
  await router(spy)('GET', '/analysis/models?days=7&includeMachine=1');
  expect(got).toEqual({ days: 7, includeMachine: true });
});

test('GET /analysis/skills returns the per-skill usage, with no price source: it carries no cost', async () => {
  // Arrange
  const call = router();
  // Act
  const res = await call('GET', '/analysis/skills');
  // Assert
  expect(res.statusCode).toBe(200);
  const body = JSON.parse(res.body);
  expect(body.skills[0].skill).toBe('pptx');
  expect(body).not.toHaveProperty('priceSource');
});

test('GET /analysis/skills forwards days and includeMachine to the service', async () => {
  // Arrange
  let got;
  const spy = { ...SERVICE, skillUsage: async (opts: any) => { got = opts; return {}; } } as unknown as Service;
  // Act
  await router(spy)('GET', '/analysis/skills?days=7&includeMachine=1');
  // Assert
  expect(got).toEqual({ days: 7, includeMachine: true });
});

test('GET /analysis/skills forwards the project filter to the service', async () => {
  // Arrange
  let got;
  const spy = { ...SERVICE, skillUsage: async (opts: any) => { got = opts; return {}; } } as unknown as Service;
  // Act
  await router(spy)('GET', '/analysis/skills?project=F--dvf');
  // Assert
  expect(got).toEqual({ days: undefined, includeMachine: false, project: 'F--dvf' });
});

test('GET /pricing returns the tariff sheet, the provenance and the versions', async () => {
  const res = await router()('GET', '/pricing');
  expect(res.statusCode).toBe(200);
  const body = JSON.parse(res.body);
  expect(body.priceTable.source).toBe('netgain-table-embarquee');
  expect(body.provenance).toBeTruthy();
  expect(body.engineVersion).toBe('0.13.0');
  expect(body.scanVersion).toBe(6);
  expect(body.priceSource).toBe('netgain-table-embarquee');
});

test('POST /pricing/adopt rend 200 et ce qui a été adopté', async () => {
  // Arrange
  const call = router({ ...SERVICE, adoptPrice: async (m: string) => ({ model: m, kind: 'modele-nouveau', from: null }) } as unknown as Service);

  // Act
  const res = await call('POST', '/pricing/adopt?model=claude-opus-5-5');

  // Assert
  expect(res.statusCode).toBe(200);
  expect(JSON.parse(res.body)).toEqual({ model: 'claude-opus-5-5', kind: 'modele-nouveau', from: null });
});

test('POST /pricing/adopt sur un modèle sans dérive connue rend 404 avec la cause', async () => {
  // Arrange
  const call = router({ ...SERVICE, adoptPrice: async () => null } as unknown as Service);

  // Act
  const res = await call('POST', '/pricing/adopt?model=claude-x-1');

  // Assert
  expect(res.statusCode).toBe(404);
  expect(JSON.parse(res.body).error).toContain('claude-x-1');
});

test('POST /pricing/adopt sans modèle rend 400', async () => {
  // Arrange
  const call = router();

  // Act
  const res = await call('POST', '/pricing/adopt');

  // Assert
  expect(res.statusCode).toBe(400);
});

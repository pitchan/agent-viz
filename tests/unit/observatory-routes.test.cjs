'use strict';
// The ten analysis endpoints: response shapes, guards, and the missing-engine
// path. The service is injected, so no SQLite file and no engine are needed.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createObservatoryRoutes } = require('../../src/server/observatory/routes.ts');

function mockRes() {
  return {
    statusCode: null, headers: null, body: '',
    writeHead(code, headers) { this.statusCode = code; this.headers = headers || null; },
    end(data) { this.body = data || ''; },
  };
}

const SERVICE = {
  summary: async () => ({ sessions: 3, netTokens: 1000, costUsd: 2, costComplete: true,
    cacheReadTokens: 500, anomalies: { parseErrors: 0, partialCostSessions: 0 },
    lastScanAt: '2026-07-15T12:00:00.000Z', engine: { ok: true, error: null } }),
  sessions: async () => [{ id: 's1', project: 'F--proj', costUsd: 1 }],
  session: async id => (id === 's1' ? { id: 's1', report: { sessionId: 's1' } } : null),
  scan: async () => ({ discovered: 2, scanned: 2, skipped: 0, failed: 0 }),
  purge: async () => {},
  configAudit: async () => ({ items: [{ kind: 'mcp', name: 'x', scope: 'user', detail: {} }],
    usage: { x: { calls: 0, sessions: 0 } }, sessions: 3 }),
  recommendations: async () => ({ groups: [{ basis: 'jetons-mesures', priority: [{ id: 1 }], all: [{ id: 1 }] }],
    stale: [] }),
  setRecommendationStatus: async (id, status) => id === 1 && status === 'ignored',
  modelCosts: async () => ({
    models: [{ model: 'claude-opus-4-8', costUsd: 1, pricing: 'tarife' }],
    totals: { netTokens: 10, costUsd: 1, costComplete: true, cacheReadTokens: 0 },
    unknownModels: [], excludedPendingRescan: 0, basis: null, period: null,
  }),
  pricing: async () => ({
    priceTable: { source: 'netgain-table-embarquee', unit: 'usd-par-jeton', entries: [], zeroCost: [] },
    provenance: { scanVersion: 6, engineVersion: '0.13.0', priceSource: 'netgain-table-embarquee', sections: [] },
    engineVersion: '0.13.0', scanVersion: 6,
  }),
};

function router(service = SERVICE) {
  const routes = createObservatoryRoutes(() => service);
  return async (method, url) => {
    const u = new URL(url, 'http://localhost');
    const route = routes.find(r =>
      r.method === method && (r.path === u.pathname || (r.prefix && u.pathname.startsWith(r.prefix))));
    assert.ok(route, `no route for ${method} ${url}`);
    const res = mockRes();
    await route.handler({ method, url, headers: {} }, res, u);
    return res;
  };
}

test('the ten analysis routes are declared with their methods', () => {
  const declared = createObservatoryRoutes(() => SERVICE)
    .map(r => `${r.method} ${r.path || r.prefix}`).sort();
  assert.deepEqual(declared, [
    'GET /analysis/models', 'GET /analysis/session/', 'GET /analysis/sessions',
    'GET /analysis/summary', 'GET /config/audit', 'GET /pricing', 'GET /recommendations',
    'POST /analysis/purge', 'POST /analysis/scan', 'POST /recommendations/',
  ]);
});

test('mutating routes are guarded by sameOrigin', () => {
  const guarded = createObservatoryRoutes(() => SERVICE)
    .filter(r => r.sameOrigin).map(r => r.path || r.prefix).sort();
  assert.deepEqual(guarded, ['/analysis/purge', '/analysis/scan', '/recommendations/']);
});

test('GET /analysis/summary returns the period totals and names its price source', async () => {
  const res = await router()('GET', '/analysis/summary');
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.sessions, 3);
  assert.equal(body.costComplete, true);
  assert.equal(body.priceSource, 'netgain-table-embarquee');
});

test('GET /analysis/summary forwards days and includeMachine to the service', async () => {
  let got;
  const spy = { ...SERVICE, summary: async opts => { got = opts; return {}; } };
  await router(spy)('GET', '/analysis/summary?days=7&includeMachine=1');
  assert.deepEqual(got, { days: 7, includeMachine: true });
});

test('an absent or non-numeric days parameter reaches the service as undefined', async () => {
  let got;
  const spy = { ...SERVICE, summary: async opts => { got = opts; return {}; } };
  await router(spy)('GET', '/analysis/summary?days=abc');
  assert.deepEqual(got, { days: undefined, includeMachine: false });
});

test('GET /analysis/sessions returns the analytic list', async () => {
  const res = await router()('GET', '/analysis/sessions?project=F--proj');
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body).map(s => s.id), ['s1']);
});

test('GET /analysis/sessions forwards the window and the toggle', async () => {
  let got;
  const spy = { ...SERVICE, sessions: async opts => { got = opts; return []; } };
  await router(spy)('GET', '/analysis/sessions?project=F--p&days=90');
  assert.deepEqual(got, { project: 'F--p', days: 90, includeMachine: false });
});

test('GET /analysis/session/:id returns the full report, 404 when unknown', async () => {
  const ok = await router()('GET', '/analysis/session/s1');
  assert.equal(ok.statusCode, 200);
  assert.equal(JSON.parse(ok.body).report.sessionId, 's1');
  assert.equal((await router()('GET', '/analysis/session/nope')).statusCode, 404);
});

test('GET /analysis/session/ with no id is a 400, not a crash', async () => {
  assert.equal((await router()('GET', '/analysis/session/')).statusCode, 400);
});

test('POST /analysis/scan answers immediately and does not wait for the scan', async () => {
  let resolveScan;
  const slow = { ...SERVICE, scan: () => new Promise(r => { resolveScan = r; }) };
  const res = await router(slow)('POST', '/analysis/scan');
  assert.equal(res.statusCode, 202);
  assert.equal(JSON.parse(res.body).started, true);
  resolveScan({ discovered: 0, scanned: 0, skipped: 0, failed: 0 });
});

test('POST /analysis/scan?days=7 passes the window, still answers 202 immediately', async () => {
  let got;
  const spy = { ...SERVICE, scan: async opts => { got = opts; } };
  const res = await router(spy)('POST', '/analysis/scan?days=7');
  assert.equal(res.statusCode, 202);
  assert.deepEqual(got, { days: 7 });
});

test('GET /config/audit returns the inventory and its usage', async () => {
  const res = await router()('GET', '/config/audit');
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).items.length, 1);
});

test('GET /recommendations returns the groups and the stale list', async () => {
  const res = await router()('GET', '/recommendations');
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.groups[0].basis, 'jetons-mesures');
  assert.deepEqual(body.stale, []);
});

test('POST /recommendations/:id accepts a known status, rejects anything else', async () => {
  const call = (id, status) => router()('POST', `/recommendations/${id}?status=${status}`);
  assert.equal((await call(1, 'ignored')).statusCode, 200);
  assert.equal((await call(1, 'deleted')).statusCode, 400);
  assert.equal((await call(2, 'ignored')).statusCode, 404);
  assert.equal((await call('abc', 'ignored')).statusCode, 400);
});

// ─── Statut « arbitré » (doc/42) : la raison entre par la même route ───────

test('POST arbitrated transmet la raison décodée au service', async () => {
  // Arrange
  let got;
  const spy = { ...SERVICE,
    setRecommendationStatus: async (id, status, reason) => { got = { id, status, reason }; return true; } };
  // Act
  const res = await router(spy)('POST',
    '/recommendations/1?status=arbitrated&reason=d%C3%A9j%C3%A0%20pes%C3%A9');
  // Assert
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), { id: 1, status: 'arbitrated' });
  assert.deepEqual(got, { id: 1, status: 'arbitrated', reason: 'déjà pesé' });
});

test('un arbitrage sans raison est un 400, avec le libellé exact', async () => {
  // Arrange — le service ne doit jamais être atteint.
  let called = false;
  const spy = { ...SERVICE, setRecommendationStatus: async () => { called = true; return true; } };
  // Act
  const res = await router(spy)('POST', '/recommendations/1?status=arbitrated');
  // Assert
  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body).error, 'raison d’arbitrage manquante');
  assert.equal(called, false);
});

test('une raison blanche vaut une raison absente', async () => {
  // Arrange
  // Act
  const res = await router()('POST', '/recommendations/1?status=arbitrated&reason=%20%20');
  // Assert
  assert.equal(res.statusCode, 400);
});

test('la raison ne voyage que pour un arbitrage — nulle pour les autres statuts', async () => {
  // Arrange
  let got;
  const spy = { ...SERVICE,
    setRecommendationStatus: async (id, status, reason) => { got = { id, status, reason }; return true; } };
  // Act
  await router(spy)('POST', '/recommendations/1?status=ignored&reason=parasite');
  // Assert
  assert.deepEqual(got, { id: 1, status: 'ignored', reason: null });
});

test('a missing engine answers 503 with the exact error, never an empty page', async () => {
  const broken = {
    ...SERVICE,
    // Message tel que Node le produit quand le moteur embarque n'a pas ete construit.
    summary: async () => { const e = new Error("Cannot find module '/app/dist/engine/core/index.js'"); e.engineMissing = true; throw e; },
  };
  const res = await router(broken)('GET', '/analysis/summary');
  assert.equal(res.statusCode, 503);
  assert.match(JSON.parse(res.body).error, /dist[\\/]engine/);
});

test('POST /analysis/purge wipes first, then starts a rebuild scan with the window', async () => {
  const events = [];
  const spy = {
    ...SERVICE,
    purge: async () => { events.push('purge'); },
    scan: async opts => { events.push(['scan', opts]); return {}; },
  };
  const res = await router(spy)('POST', '/analysis/purge?days=7');
  assert.equal(res.statusCode, 202);
  assert.deepEqual(JSON.parse(res.body), { purged: true, started: true });
  assert.deepEqual(events, ['purge', ['scan', { days: 7 }]]);
});

test('POST /analysis/purge answers 503 and never scans when the engine is missing', async () => {
  let scanned = false;
  const missing = new Error('netgain introuvable');
  missing.engineMissing = true;
  const spy = {
    ...SERVICE,
    purge: async () => { throw missing; },
    scan: async () => { scanned = true; },
  };
  const res = await router(spy)('POST', '/analysis/purge');
  assert.equal(res.statusCode, 503);
  assert.equal(scanned, false);
});

test('GET /analysis/models returns the breakdown and names its price source', async () => {
  const res = await router()('GET', '/analysis/models');
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.models[0].model, 'claude-opus-4-8');
  assert.equal(body.totals.costUsd, 1);
  assert.equal(body.priceSource, 'netgain-table-embarquee');
});

test('GET /analysis/models forwards days and includeMachine to the service', async () => {
  let got;
  const spy = { ...SERVICE, modelCosts: async opts => { got = opts; return {}; } };
  await router(spy)('GET', '/analysis/models?days=7&includeMachine=1');
  assert.deepEqual(got, { days: 7, includeMachine: true });
});

test('GET /pricing returns the tariff sheet, the provenance and the versions', async () => {
  const res = await router()('GET', '/pricing');
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.priceTable.source, 'netgain-table-embarquee');
  assert.ok(body.provenance);
  assert.equal(body.engineVersion, '0.13.0');
  assert.equal(body.scanVersion, 6);
  assert.equal(body.priceSource, 'netgain-table-embarquee');
});

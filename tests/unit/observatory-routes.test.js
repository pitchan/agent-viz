'use strict';
// The seven analysis endpoints: response shapes, guards, and the missing-engine
// path. The service is injected, so no SQLite file and no engine are needed.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createObservatoryRoutes } = require('../../lib/server/observatory/routes');

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
  configAudit: async () => ({ items: [{ kind: 'mcp', name: 'x', scope: 'user', detail: {} }],
    usage: { x: { calls: 0, sessions: 0 } }, sessions: 3 }),
  recommendations: async () => ({ groups: [{ basis: 'jetons-mesures', priority: [{ id: 1 }], all: [{ id: 1 }] }],
    stale: [] }),
  setRecommendationStatus: async (id, status) => id === 1 && status === 'ignored',
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

test('the seven analysis routes are declared with their methods', () => {
  const declared = createObservatoryRoutes(() => SERVICE)
    .map(r => `${r.method} ${r.path || r.prefix}`).sort();
  assert.deepEqual(declared, [
    'GET /analysis/session/', 'GET /analysis/sessions', 'GET /analysis/summary',
    'GET /config/audit', 'GET /recommendations',
    'POST /analysis/scan', 'POST /recommendations/',
  ]);
});

test('mutating routes are guarded by sameOrigin', () => {
  const guarded = createObservatoryRoutes(() => SERVICE)
    .filter(r => r.sameOrigin).map(r => r.path || r.prefix).sort();
  assert.deepEqual(guarded, ['/analysis/scan', '/recommendations/']);
});

test('GET /analysis/summary returns the period totals and names its price source', async () => {
  const res = await router()('GET', '/analysis/summary');
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.sessions, 3);
  assert.equal(body.costComplete, true);
  assert.equal(body.priceSource, 'netgain-table-embarquee');
});

test('GET /analysis/sessions returns the analytic list', async () => {
  const res = await router()('GET', '/analysis/sessions?project=F--proj');
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body).map(s => s.id), ['s1']);
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

test('a missing engine answers 503 with the exact error, never an empty page', async () => {
  const broken = {
    ...SERVICE,
    summary: async () => { const e = new Error("Cannot find package '@vcueto/netgain'"); e.engineMissing = true; throw e; },
  };
  const res = await router(broken)('GET', '/analysis/summary');
  assert.equal(res.statusCode, 503);
  assert.match(JSON.parse(res.body).error, /@vcueto\/netgain/);
});

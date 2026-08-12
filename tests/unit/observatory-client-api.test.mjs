// api.js — the observatory's HTTP client. These tests stub the global fetch
// so the query strings it builds (project, days, includeMachine) are checked
// without a real server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchSummary, fetchSessions, requestScan, requestPurge, fetchModelCosts, fetchPricing, acknowledgeAlert } from '../../src/web/observatory/api.js';

function stubFetch(body = {}) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = (url, opts) => {
    calls.push({ url, opts });
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

test('fetchSummary with no window omits the query string', async () => {
  const { calls, restore } = stubFetch();
  try {
    await fetchSummary();
    assert.equal(calls[0].url, '/analysis/summary');
  } finally {
    restore();
  }
});

test('fetchSummary forwards days and includeMachine', async () => {
  const { calls, restore } = stubFetch();
  try {
    await fetchSummary({ days: 7, includeMachine: true });
    assert.equal(calls[0].url, '/analysis/summary?days=7&includeMachine=1');
  } finally {
    restore();
  }
});

test('fetchSessions forwards project together with the window', async () => {
  const { calls, restore } = stubFetch([]);
  try {
    await fetchSessions({ project: 'F--proj', days: 90, includeMachine: false });
    assert.equal(calls[0].url, '/analysis/sessions?days=90&project=F--proj');
  } finally {
    restore();
  }
});

test('requestScan forwards only days, as a POST', async () => {
  const { calls, restore } = stubFetch({ started: true });
  try {
    await requestScan({ days: 7 });
    assert.equal(calls[0].url, '/analysis/scan?days=7');
    assert.equal(calls[0].opts.method, 'POST');
  } finally {
    restore();
  }
});

test('requestScan with no window omits the query string', async () => {
  const { calls, restore } = stubFetch({ started: true });
  try {
    await requestScan();
    assert.equal(calls[0].url, '/analysis/scan');
  } finally {
    restore();
  }
});

test('requestPurge posts to /analysis/purge with only days', async () => {
  const { calls, restore } = stubFetch({ purged: true, started: true });
  try {
    await requestPurge({ days: 30 });
    assert.equal(calls[0].url, '/analysis/purge?days=30');
    assert.equal(calls[0].opts.method, 'POST');
  } finally {
    restore();
  }
});

test('fetchModelCosts forwards the window; no window means no query string', async () => {
  const { calls, restore } = stubFetch({ models: [] });
  try {
    await fetchModelCosts({ days: 30, includeMachine: true });
    await fetchModelCosts();
    assert.equal(calls[0].url, '/analysis/models?days=30&includeMachine=1');
    assert.equal(calls[1].url, '/analysis/models');
  } finally {
    restore();
  }
});

test('fetchPricing is window-independent', async () => {
  const { calls, restore } = stubFetch({ priceTable: { entries: [] } });
  try {
    await fetchPricing();
    assert.equal(calls[0].url, '/pricing');
  } finally {
    restore();
  }
});

test('acknowledgeAlert poste id et createdAt en corps JSON', async () => {
  const { calls, restore } = stubFetch({ ok: true });
  try {
    await acknowledgeAlert({ id: 'badInvocation:sid1:inv-x', createdAt: 1754700000000 });
    assert.equal(calls[0].url, '/alerts/ack');
    assert.equal(calls[0].opts.method, 'POST');
    assert.equal(calls[0].opts.headers['Content-Type'], 'application/json');
    assert.deepEqual(JSON.parse(calls[0].opts.body),
      { id: 'badInvocation:sid1:inv-x', createdAt: 1754700000000 });
  } finally {
    restore();
  }
});

// Non-regression (revue doc/32) : donner un corps a postJson ne doit pas en
// donner un aux POST existants — la route de scan n'en attend aucun.
test('requestScan et requestPurge continuent de poster SANS corps', async () => {
  const { calls, restore } = stubFetch({ started: true });
  try {
    await requestScan({ days: 7 });
    await requestPurge({ days: 7 });
    for (const { opts } of calls) {
      assert.equal(opts.body, undefined);
      assert.equal(opts.headers, undefined);
    }
  } finally {
    restore();
  }
});

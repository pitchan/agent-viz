// api.js — the observatory's HTTP client. These tests stub the global fetch
// so the query strings it builds (project, days, includeMachine) are checked
// without a real server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchSummary, fetchSessions, requestScan } from '../../public/observatory/api.js';

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
  await fetchSummary();
  assert.equal(calls[0].url, '/analysis/summary');
  restore();
});

test('fetchSummary forwards days and includeMachine', async () => {
  const { calls, restore } = stubFetch();
  await fetchSummary({ days: 7, includeMachine: true });
  assert.equal(calls[0].url, '/analysis/summary?days=7&includeMachine=1');
  restore();
});

test('fetchSessions forwards project together with the window', async () => {
  const { calls, restore } = stubFetch([]);
  await fetchSessions({ project: 'F--proj', days: 90, includeMachine: false });
  assert.equal(calls[0].url, '/analysis/sessions?days=90&project=F--proj');
  restore();
});

test('requestScan forwards only days, as a POST', async () => {
  const { calls, restore } = stubFetch({ started: true });
  await requestScan({ days: 7 });
  assert.equal(calls[0].url, '/analysis/scan?days=7');
  assert.equal(calls[0].opts.method, 'POST');
  restore();
});

test('requestScan with no window omits the query string', async () => {
  const { calls, restore } = stubFetch({ started: true });
  await requestScan();
  assert.equal(calls[0].url, '/analysis/scan');
  restore();
});

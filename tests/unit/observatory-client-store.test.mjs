// Client-side state for both observatory pages. The HTTP client is injected,
// so no server and no DOM are involved.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getState, subscribe, loadAdvisor, loadAnalysis, loadSession, changeStatus, applyScanEvent, resetStore,
  setPeriodDays, setIncludeMachine, loadPricing } from '../../src/web/observatory/store.js';

const SUMMARY = { sessions: 3, costUsd: 2, netTokens: 1000, costComplete: true,
  priceSource: 'netgain-table-embarquee' };
const RECS = { groups: [{ basis: 'jetons-mesures', priority: [{ id: 1 }], all: [{ id: 1 }] }], stale: [] };

function fakeApi(over = {}) {
  return {
    fetchSummary: async () => SUMMARY,
    fetchRecommendations: async () => RECS,
    fetchSessions: async () => [{ id: 's1' }],
    fetchSession: async id => ({ id, report: { sessionId: id } }),
    setRecommendationStatus: async () => ({ id: 1, status: 'ignored' }),
    ...over,
  };
}

test('the store starts empty and resets cleanly', () => {
  resetStore();
  const s = getState();
  assert.equal(s.summary, null);
  assert.deepEqual(s.recommendations, { groups: [], stale: [], decided: [] });
  assert.equal(s.error, null);
  assert.equal(s.loading, false);
});

test('loadAdvisor fills summary and recommendations and notifies subscribers', async () => {
  resetStore();
  let notifications = 0;
  const off = subscribe(() => { notifications++; });
  await loadAdvisor(fakeApi());
  assert.deepEqual(getState().summary, SUMMARY);
  assert.deepEqual(getState().recommendations, RECS);
  assert.equal(getState().loading, false);
  assert.ok(notifications >= 2, 'at least one notification while loading and one when done');
  off();
});

test('an unsubscribed listener stops being called', async () => {
  resetStore();
  let calls = 0;
  subscribe(() => { calls++; })();
  await loadAdvisor(fakeApi());
  assert.equal(calls, 0);
});

test('a failing call records the exact error and clears loading', async () => {
  resetStore();
  await loadAdvisor(fakeApi({
    fetchSummary: async () => { throw new Error("Cannot find module '/app/dist/engine/core/index.js'"); },
  }));
  assert.match(getState().error, /dist[\\/]engine/);
  assert.equal(getState().loading, false);
  assert.equal(getState().summary, null);
});

test('loadAnalysis fills the session list, loadSession fills the selection', async () => {
  resetStore();
  await loadAnalysis(fakeApi());
  assert.deepEqual(getState().sessions.map(s => s.id), ['s1']);
  await loadSession(fakeApi(), 's1');
  assert.equal(getState().selectedSession.report.sessionId, 's1');
});

test('changeStatus refreshes the recommendations rather than patching them locally', async () => {
  resetStore();
  let refreshes = 0;
  const api = fakeApi({ fetchRecommendations: async () => { refreshes++; return RECS; } });
  await loadAdvisor(api);
  await changeStatus(api, 1, 'ignored');
  assert.equal(refreshes, 2, 'the server decides what the list becomes, not the page');
});

test('changeStatus transmet la raison d’arbitrage au client HTTP', async () => {
  // Arrange
  resetStore();
  let got;
  const api = fakeApi({
    setRecommendationStatus: async (id, status, reason) => { got = { id, status, reason }; return {}; },
  });
  // Act
  await changeStatus(api, 4, 'arbitrated', 'déjà pesé');
  // Assert
  assert.deepEqual(got, { id: 4, status: 'arbitrated', reason: 'déjà pesé' });
});

test('loadAdvisor passes the selected window and toggle to the api', async () => {
  resetStore();
  const calls = [];
  const api = {
    fetchSummary: opts => { calls.push(opts); return Promise.resolve({}); },
    fetchRecommendations: () => Promise.resolve({ groups: [], stale: [] }),
  };
  setPeriodDays(7);
  setIncludeMachine(true);
  await loadAdvisor(api);
  assert.deepEqual(calls[0], { days: 7, includeMachine: true });
});

test('loadAnalysis passes the same shared state', async () => {
  resetStore();
  const api = {
    fetchSessions: opts => { assert.deepEqual(opts, { days: 90, includeMachine: false }); return Promise.resolve([]); },
    fetchSummary: () => Promise.resolve({}),
  };
  setPeriodDays(90);
  setIncludeMachine(false);
  await loadAnalysis(api);
});

test('the defaults are 30 days, machines excluded', () => {
  resetStore();
  assert.equal(getState().periodDays, 30);
  assert.equal(getState().includeMachine, false);
});

test('scan events update the progress and only the done phase is a completion', () => {
  resetStore();
  applyScanEvent({ type: 'analysisScan', phase: 'progress', total: 10, scanned: 4, skipped: 1, failed: 0 });
  assert.deepEqual(getState().scan, { phase: 'progress', total: 10, scanned: 4, skipped: 1, failed: 0 });
  assert.equal(getState().scanJustFinished, false);
  applyScanEvent({ type: 'analysisScan', phase: 'done', total: 10, scanned: 9, skipped: 1, failed: 0 });
  assert.equal(getState().scanJustFinished, true);
});

test('loadPricing loads the windowed breakdown and the tariff sheet together', async () => {
  resetStore();
  const calls = [];
  const api = {
    fetchModelCosts: async opts => { calls.push(['models', opts]); return { models: [], totals: {} }; },
    fetchPricing: async () => { calls.push(['pricing']); return { priceTable: { entries: [] } }; },
  };
  await loadPricing(api);
  const s = getState();
  assert.deepEqual(s.modelCosts, { models: [], totals: {} });
  assert.deepEqual(s.pricing, { priceTable: { entries: [] } });
  assert.equal(s.loading, false);
  assert.deepEqual(calls[0], ['models', { days: 30, includeMachine: false }]);
});

// Client-side state for both observatory pages. The HTTP client is injected,
// so no server and no DOM are involved.
import { expect, test } from 'vitest';
import { getState, subscribe, loadAdvisor, loadAnalysis, loadSession, changeStatus, applyScanEvent, resetStore,
  setPeriodDays, setIncludeMachine, loadPricing, loadSkills } from '../../src/web/observatory/store.ts';
import type { WindowOpts } from '../../src/web/observatory/api.ts';

// Le client HTTP tel que les vues l'importent — même définition que celle,
// non exportée, de store.ts (CLAUDE.md § D : référencer le module réel plutôt
// que dupliquer sa forme).
type ApiClient = typeof import('../../src/web/observatory/api.ts');

const SUMMARY = { sessions: 3, costUsd: 2, netTokens: 1000, costComplete: true,
  priceSource: 'netgain-table-embarquee' };
const RECS = { groups: [{ basis: 'jetons-mesures', priority: [{ id: 1 }], all: [{ id: 1 }] }], stale: [] };

// Fixture partielle : chaque test ne stube que les méthodes qu'il exerce,
// jamais la forme complète d'ApiClient — d'où le cast.
function fakeApi(over: Partial<ApiClient> = {}): ApiClient {
  return {
    fetchSummary: async () => SUMMARY,
    fetchRecommendations: async () => RECS,
    fetchSessions: async () => [{ id: 's1' }],
    fetchSession: async (id: string) => ({ id, report: { sessionId: id } }),
    setRecommendationStatus: async () => ({ id: 1, status: 'ignored' }),
    ...over,
  } as unknown as ApiClient;
}

test('the store starts empty and resets cleanly', () => {
  resetStore();
  const s = getState();
  expect(s.summary).toBe(null);
  expect(s.recommendations).toEqual({ groups: [], stale: [], decided: [] });
  expect(s.error).toBe(null);
  expect(s.loading).toBe(false);
});

test('loadAdvisor fills summary and recommendations and notifies subscribers', async () => {
  resetStore();
  let notifications = 0;
  const off = subscribe(() => { notifications++; });
  await loadAdvisor(fakeApi());
  expect(getState().summary).toEqual(SUMMARY);
  expect(getState().recommendations).toEqual(RECS);
  expect(getState().loading).toBe(false);
  expect(notifications >= 2, 'at least one notification while loading and one when done').toBeTruthy();
  off();
});

test('an unsubscribed listener stops being called', async () => {
  resetStore();
  let calls = 0;
  subscribe(() => { calls++; })();
  await loadAdvisor(fakeApi());
  expect(calls).toBe(0);
});

test('a failing call records the exact error and clears loading', async () => {
  resetStore();
  await loadAdvisor(fakeApi({
    fetchSummary: async () => { throw new Error("Cannot find module '/app/dist/engine/core/index.js'"); },
  }));
  expect(getState().error).toMatch(/dist[\\/]engine/);
  expect(getState().loading).toBe(false);
  expect(getState().summary).toBe(null);
});

test('loadAnalysis fills the session list, loadSession fills the selection', async () => {
  resetStore();
  await loadAnalysis(fakeApi());
  expect((getState().sessions as Array<{ id: string }>).map(s => s.id)).toEqual(['s1']);
  await loadSession(fakeApi(), 's1');
  expect((getState().selectedSession as { report: { sessionId: string } }).report.sessionId).toBe('s1');
});

test('changeStatus refreshes the recommendations rather than patching them locally', async () => {
  resetStore();
  let refreshes = 0;
  const api = fakeApi({ fetchRecommendations: async () => { refreshes++; return RECS; } });
  await loadAdvisor(api);
  await changeStatus(api, 1, 'ignored');
  expect(refreshes, 'the server decides what the list becomes, not the page').toBe(2);
});

test('changeStatus transmet la raison d’arbitrage au client HTTP', async () => {
  // Arrange
  resetStore();
  let got: { id: number; status: string; reason?: string } | undefined;
  const api = fakeApi({
    setRecommendationStatus: async (id: number, status: string, reason?: string) => { got = { id, status, reason }; return {}; },
  });
  // Act
  await changeStatus(api, 4, 'arbitrated', 'déjà pesé');
  // Assert
  expect(got).toEqual({ id: 4, status: 'arbitrated', reason: 'déjà pesé' });
});

test('loadAdvisor passes the selected window and toggle to the api', async () => {
  resetStore();
  const calls: WindowOpts[] = [];
  const api = {
    fetchSummary: (opts: WindowOpts) => { calls.push(opts); return Promise.resolve({}); },
    fetchRecommendations: () => Promise.resolve({ groups: [], stale: [] }),
  } as unknown as ApiClient;
  setPeriodDays(7);
  setIncludeMachine(true);
  await loadAdvisor(api);
  expect(calls[0]).toEqual({ days: 7, includeMachine: true });
});

test('loadAnalysis passes the same shared state', async () => {
  resetStore();
  const api = {
    fetchSessions: (opts: WindowOpts) => { expect(opts).toEqual({ days: 90, includeMachine: false }); return Promise.resolve([]); },
    fetchSummary: () => Promise.resolve({}),
  } as unknown as ApiClient;
  setPeriodDays(90);
  setIncludeMachine(false);
  await loadAnalysis(api);
});

test('the defaults are 30 days, machines excluded', () => {
  resetStore();
  expect(getState().periodDays).toBe(30);
  expect(getState().includeMachine).toBe(false);
});

test('scan events update the progress and only the done phase is a completion', () => {
  resetStore();
  applyScanEvent({ type: 'analysisScan', phase: 'progress', total: 10, scanned: 4, skipped: 1, failed: 0 } as any);
  expect(getState().scan).toEqual({ phase: 'progress', total: 10, scanned: 4, skipped: 1, failed: 0 });
  expect(getState().scanJustFinished).toBe(false);
  applyScanEvent({ type: 'analysisScan', phase: 'done', total: 10, scanned: 9, skipped: 1, failed: 0 } as any);
  expect(getState().scanJustFinished).toBe(true);
});

test('loadPricing loads the windowed breakdown and the tariff sheet together', async () => {
  resetStore();
  const calls: unknown[] = [];
  const api = {
    fetchModelCosts: async (opts: WindowOpts) => { calls.push(['models', opts]); return { models: [], totals: {} }; },
    fetchPricing: async () => { calls.push(['pricing']); return { priceTable: { entries: [] } }; },
  } as unknown as ApiClient;
  await loadPricing(api);
  const s = getState();
  expect(s.modelCosts).toEqual({ models: [], totals: {} });
  expect(s.pricing).toEqual({ priceTable: { entries: [] } });
  expect(s.loading).toBe(false);
  expect(calls[0]).toEqual(['models', { days: 30, includeMachine: false }]);
});

test('loadSkills loads the per-skill usage on the current window', async () => {
  // Arrange
  resetStore();
  const calls: unknown[] = [];
  const api = {
    fetchSkillUsage: async (opts: WindowOpts) => { calls.push(opts); return { skills: [] }; },
  } as unknown as ApiClient;
  // Act
  await loadSkills(api);
  // Assert
  expect(getState().skillUsage).toEqual({ skills: [] });
  expect(calls[0]).toEqual({ days: 30, includeMachine: false });
});

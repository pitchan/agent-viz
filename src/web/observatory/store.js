// store.js — shared state for both observatory pages, with subscription.
//
// The two views read from here and never fetch on their own; the HTTP client
// arrives as a parameter so this module is testable without a server. Same
// role as viz-state.js for the canvas view, scoped to the observatory.

const EMPTY = () => ({
  summary: null,
  recommendations: { groups: [], stale: [], arbitrated: [] },
  sessions: [],
  selectedSession: null,
  scan: null,
  scanJustFinished: false,
  loading: false,
  error: null,
  periodDays: 30,
  includeMachine: false,
  modelCosts: null,
  pricing: null,
});

let state = EMPTY();
const listeners = new Set();

export function getState() {
  return state;
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function resetStore() {
  state = EMPTY();
  notify();
}

function notify() {
  for (const fn of listeners) fn(state);
}

function patch(changes) {
  state = { ...state, ...changes };
  notify();
}

// Every loader shares the same shape: announce loading, run, record the exact
// error on failure. Duplicating it in each loader is where inconsistent error
// handling creeps in.
async function run(work) {
  patch({ loading: true, error: null });
  try {
    patch({ ...await work(), loading: false });
  } catch (err) {
    patch({ loading: false, error: err.message });
  }
}

// The window and the human/machine toggle are shared by both pages — a
// single logical selector, not one per view (period-selector.js renders it).
export const setPeriodDays = days => patch({ periodDays: days });
export const setIncludeMachine = flag => patch({ includeMachine: flag });

export const loadAdvisor = api => run(async () => {
  const { periodDays, includeMachine } = getState();
  const [summary, recommendations] = await Promise.all([
    api.fetchSummary({ days: periodDays, includeMachine }),
    api.fetchRecommendations(),
  ]);
  return { summary, recommendations, scanJustFinished: false };
});

// The summary rides along so the Sessions page can announce the same basis
// (human/machine, period) as the Advice page, without a second round trip.
export const loadAnalysis = api => run(async () => {
  const { periodDays, includeMachine } = getState();
  const [sessions, summary] = await Promise.all([
    api.fetchSessions({ days: periodDays, includeMachine }),
    api.fetchSummary({ days: periodDays, includeMachine }),
  ]);
  return { sessions, summary };
});

export const loadSession = (api, id) => run(async () => ({ selectedSession: await api.fetchSession(id) }));

// The pricing panel loads its two halves together: the windowed per-model
// breakdown, and the window-independent tariff sheet + provenance.
export const loadPricing = api => run(async () => {
  const { periodDays, includeMachine } = getState();
  const [modelCosts, pricing] = await Promise.all([
    api.fetchModelCosts({ days: periodDays, includeMachine }),
    api.fetchPricing(),
  ]);
  return { modelCosts, pricing };
});

// After a status change the server decides what the list becomes — the page
// never patches a recommendation locally, or the +50 % and freshness rules
// would be re-implemented in two places.
export const changeStatus = (api, id, status, reason) => run(async () => {
  await api.setRecommendationStatus(id, status, reason);
  return { recommendations: await api.fetchRecommendations() };
});

export function applyScanEvent(msg) {
  patch({
    scan: { phase: msg.phase, total: msg.total, scanned: msg.scanned, skipped: msg.skipped, failed: msg.failed },
    scanJustFinished: msg.phase === 'done',
  });
}

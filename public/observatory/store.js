// store.js — shared state for both observatory pages, with subscription.
//
// The two views read from here and never fetch on their own; the HTTP client
// arrives as a parameter so this module is testable without a server. Same
// role as viz-state.js for the canvas view, scoped to the observatory.

const EMPTY = () => ({
  summary: null,
  recommendations: { groups: [], stale: [] },
  sessions: [],
  selectedSession: null,
  scan: null,
  scanJustFinished: false,
  loading: false,
  error: null,
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

export const loadAdvisor = api => run(async () => {
  const [summary, recommendations] = await Promise.all([
    api.fetchSummary(), api.fetchRecommendations(),
  ]);
  return { summary, recommendations, scanJustFinished: false };
});

export const loadAnalysis = api => run(async () => ({ sessions: await api.fetchSessions() }));

export const loadSession = (api, id) => run(async () => ({ selectedSession: await api.fetchSession(id) }));

// After a status change the server decides what the list becomes — the page
// never patches a recommendation locally, or the +50 % and freshness rules
// would be re-implemented in two places.
export const changeStatus = (api, id, status) => run(async () => {
  await api.setRecommendationStatus(id, status);
  return { recommendations: await api.fetchRecommendations() };
});

export function applyScanEvent(msg) {
  patch({
    scan: { phase: msg.phase, total: msg.total, scanned: msg.scanned, skipped: msg.skipped, failed: msg.failed },
    scanJustFinished: msg.phase === 'done',
  });
}

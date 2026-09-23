// store.ts — shared state for both observatory pages, with subscription.
//
// The two views read from here and never fetch on their own; the HTTP client
// arrives as a parameter so this module is testable without a server. Same
// role as viz-state.ts for the canvas view, scoped to the observatory.

// Les payloads serveur (summary, recommendations, sessions, modelCosts,
// pricing, skillUsage) restent `unknown` : ce fichier les fait circuler sans jamais lire
// leur forme interne — c'est l'affaire des vues qui les affichent.
export interface ObservatoryState {
  summary: unknown;
  recommendations: unknown;
  sessions: unknown[];
  selectedSession: unknown;
  scan: ScanEventMessage | null;
  scanJustFinished: boolean;
  loading: boolean;
  error: string | null;
  periodDays: number;
  includeMachine: boolean;
  modelCosts: unknown;
  pricing: unknown;
  skillUsage: unknown;
  skillsProject: string | null;
}

const EMPTY = (): ObservatoryState => ({
  summary: null,
  recommendations: { groups: [], stale: [], decided: [] },
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
  skillUsage: null,
  skillsProject: null,
});

// Le client HTTP tel que les vues l'importent (`import * as api from './api.ts'`) —
// reference son type sans en dupliquer la forme.
type ApiClient = typeof import('./api.ts');

let state: ObservatoryState = EMPTY();
const listeners = new Set<(state: ObservatoryState) => void>();

export function getState() {
  return state;
}

export function subscribe(fn: (state: ObservatoryState) => void) {
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

function patch(changes: Partial<ObservatoryState>) {
  state = { ...state, ...changes };
  notify();
}

// Every loader shares the same shape: announce loading, run, record the exact
// error on failure. Duplicating it in each loader is where inconsistent error
// handling creeps in.
async function run(work: () => Promise<Partial<ObservatoryState>>) {
  patch({ loading: true, error: null });
  try {
    patch({ ...await work(), loading: false });
  } catch (err) {
    // Les echecs reels de ce fichier sont toujours des Error (getJson/postJson
    // n'en levent pas d'autre sorte) ; la garde couvre le seul cas ou ce ne
    // serait pas vrai, sans en faire une hypothese muette.
    patch({ loading: false, error: err instanceof Error ? err.message : String(err) });
  }
}

// The window and the human/machine toggle are shared by both pages — a
// single logical selector, not one per view (period-selector.ts renders it).
export const setPeriodDays = (days: number) => patch({ periodDays: days });
export const setIncludeMachine = (flag: boolean) => patch({ includeMachine: flag });

// Le projet du panneau Skills, à lui seul : aucun autre panneau ne filtre par
// projet, et la fenêtre reste, elle, commune à tous.
export const setSkillsProject = (project: string | null) => patch({ skillsProject: project });

export const loadAdvisor = (api: ApiClient) => run(async () => {
  const { periodDays, includeMachine } = getState();
  const [summary, recommendations] = await Promise.all([
    api.fetchSummary({ days: periodDays, includeMachine }),
    api.fetchRecommendations(),
  ]);
  return { summary, recommendations, scanJustFinished: false };
});

// The summary rides along so the Sessions page can announce the same basis
// (human/machine, period) as the Advice page, without a second round trip.
export const loadAnalysis = (api: ApiClient) => run(async () => {
  const { periodDays, includeMachine } = getState();
  const [sessions, summary] = await Promise.all([
    api.fetchSessions({ days: periodDays, includeMachine }),
    api.fetchSummary({ days: periodDays, includeMachine }),
  ]);
  return { sessions, summary };
});

export const loadSession = (api: ApiClient, id: string) => run(async () => ({ selectedSession: await api.fetchSession(id) }));

// The pricing panel loads its two halves together: the windowed per-model
// breakdown, and the window-independent tariff sheet + provenance.
export const loadPricing = (api: ApiClient) => run(async () => {
  const { periodDays, includeMachine } = getState();
  const [modelCosts, pricing] = await Promise.all([
    api.fetchModelCosts({ days: periodDays, includeMachine }),
    api.fetchPricing(),
  ]);
  return { modelCosts, pricing };
});

// Le panneau Skills ne lit jamais au-delà : Claude Code efface les transcripts
// après 30 jours (cleanupPeriodDays), et sans transcript une session n'a aucun
// fait de skills. Les autres panneaux gardent les trois fenêtres.
export const SKILLS_MAX_DAYS = 30;

export const loadSkills = (api: ApiClient) => run(async () => {
  const { periodDays, includeMachine, skillsProject } = getState();
  return { skillUsage: await api.fetchSkillUsage({
    days: Math.min(periodDays, SKILLS_MAX_DAYS), includeMachine, project: skillsProject ?? undefined,
  }) };
});

// After a status change the server decides what the list becomes — the page
// never patches a recommendation locally, or the +50 % and freshness rules
// would be re-implemented in two places.
export const changeStatus = (api: ApiClient, id: number, status: string, reason?: string) => run(async () => {
  await api.setRecommendationStatus(id, status, reason);
  return { recommendations: await api.fetchRecommendations() };
});

interface ScanEventMessage {
  phase: string;
  total: number;
  scanned: number;
  skipped: number;
  failed: number;
}

export function applyScanEvent(msg: ScanEventMessage) {
  patch({
    scan: { phase: msg.phase, total: msg.total, scanned: msg.scanned, skipped: msg.skipped, failed: msg.failed },
    scanJustFinished: msg.phase === 'done',
  });
}

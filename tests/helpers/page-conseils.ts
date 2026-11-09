// La page Conseils ouverte par son bouton, sur un faux document et un faux
// client du serveur passe a initAdvisor : chaque test repart d'une page neuve.
import { vi } from 'vitest';
import { fauxElement, parClasse, texte } from './faux-dom.ts';
import type { Recommendation } from '../../src/web/observatory/format.ts';

type ApiClient = typeof import('../../src/web/observatory/api.ts');

const T0 = Date.UTC(2026, 9, 19, 20, 0);

export const panne = {
  id: 'p1', type: 'loop', sessionId: 's1', toolName: 'Bash', count: 4, createdAt: T0,
  message: '', agentId: '', agentType: '', subject: 'git status', occurrences: [], tools: [],
  cwd: 'F:\\DEV\\agent-viz', standing: false, patternId: '', acknowledged: false,
};

const resume = {
  period: { days: 30, from: '2026-09-19T00:00:00Z', to: '2026-10-19T00:00:00Z' },
  sessions: 3, costUsd: 1.5, netTokens: 1000, cacheReadTokens: 2000, priceSource: 'grille', basis: null,
};

export const conseil = (sur: Partial<Recommendation> = {}): Recommendation => ({
  id: 7, title: 'Sessions laissant des modifications non vérifiées',
  confidence: 'fait', ruleId: 'R7', evidence: { sessions: [], costComplete: true },
  action: 'Terminer par la preuve : relancer la commande de test ou de build.',
  estimatedCostUsd: 20.38, costBasis: 'jetons-mesures', status: 'new',
  periodFrom: '2026-09-20T00:00:00Z', periodTo: '2026-10-20T00:00:00Z', ...sur,
});

// Adoptée à 10 $, revenue à 20,38 $ : elle porte un bandeau de retour.
export const conseilRevenu = (sur: Partial<Recommendation> = {}) =>
  conseil({ status: 'accepted', costAtStatusUsd: 10, statusAt: '2026-10-01T00:00:00Z', ...sur });

interface Conseils { groups: { basis: string; priority: Recommendation[]; all: Recommendation[] }[]; stale: Recommendation[]; decided: Recommendation[] }

export interface Serveur {
  alertes?: unknown[];
  // Une analyse en panne refuse le résumé et la liste avec sa cause.
  analyse?: 'ok' | 'en panne';
  conseils?: Partial<Conseils>;
  // Une réponse refusée rejette l'enregistrement d'une décision avec sa cause.
  decision?: 'ok' | 'refusee';
}

function fauxClient({ alertes = [], analyse = 'ok', conseils = {}, decision = 'ok' }: Serveur): ApiClient {
  const parAnalyse = (v: unknown) => analyse === 'en panne' ? Promise.reject(new Error('base illisible')) : Promise.resolve(v);
  const liste: Conseils = { groups: [], stale: [], decided: [], ...conseils };
  const client = {
    fetchAlerts: () => Promise.resolve({ alerts: alertes, rejetees: 0, activeIds: [] }),
    fetchSummary: () => parAnalyse(resume),
    fetchRecommendations: () => parAnalyse(liste),
    setRecommendationStatus: () =>
      decision === 'refusee' ? Promise.reject(new Error('serveur injoignable')) : Promise.resolve({}),
    acknowledgeAlert: () => Promise.resolve({}),
    requestScan: () => Promise.resolve({}),
    requestPurge: () => Promise.resolve({}),
  };
  return client as unknown as ApiClient;
}

// Toutes les réponses du faux client sont déjà résolues : une tâche plus tard,
// la page a fini de les lire.
export const laPageAFiniDeLire = () => new Promise(r => setImmediate(r));

export async function ouvrirLaPage(serveur: Serveur) {
  const noeuds = new Map<string, any>();
  const fenetre: Record<string, (e: unknown) => void> = {};
  vi.stubGlobal('document', {
    createElement: fauxElement,
    getElementById: (id: string) => {
      if (!noeuds.has(id)) noeuds.set(id, fauxElement('div'));
      return noeuds.get(id);
    },
  });
  vi.stubGlobal('window', { addEventListener: (evt: string, fn: (e: unknown) => void) => { fenetre[evt] = fn; } });
  vi.resetModules();
  const { initAdvisor } = await import('../../src/web/observatory/advisor-view.ts');
  initAdvisor(fauxClient(serveur));
  noeuds.get('btn-advisor').click();
  await laPageAFiniDeLire();
  return { noeud: (id: string) => noeuds.get(id), fenetre };
}

export type PageConseils = Awaited<ReturnType<typeof ouvrirLaPage>>;

export const compteur = (page: PageConseils, libelle: string) =>
  parClasse(page.noeud('advisor-tabs'), 'advisor-counter').find(c => texte(c).includes(libelle));

export async function finDAnalyse(page: PageConseils) {
  page.fenetre['agentviz:analysisScan']!({ detail: { phase: 'done', total: 1, scanned: 1, skipped: 0, failed: 0 } });
  await laPageAFiniDeLire();
}

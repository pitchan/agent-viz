// Le haut de la page Conseils une fois câblé : quel onglet s'ouvre, ce qu'il
// cache, ce qu'il garde d'un rendu à l'autre, et la page sans analyse. La page
// est ouverte par son bouton, sur un faux document et un faux serveur.
import { afterEach, expect, test, vi } from 'vitest';
import { fauxElement, parClasse, texte } from '../helpers/faux-dom.ts';

const T0 = Date.UTC(2026, 9, 19, 20, 0);

const panne = {
  id: 'p1', type: 'loop', sessionId: 's1', toolName: 'Bash', count: 4, createdAt: T0,
  message: '', agentId: '', agentType: '', subject: 'git status', occurrences: [], tools: [],
  cwd: 'F:\\DEV\\agent-viz', standing: false, patternId: '', acknowledged: false,
};

const resume = {
  period: { days: 30, from: '2026-09-19T00:00:00Z', to: '2026-10-19T00:00:00Z' },
  sessions: 3, costUsd: 1.5, netTokens: 1000, cacheReadTokens: 2000, priceSource: 'grille', basis: null,
};

interface Serveur { alertes?: unknown[]; analyse?: 'ok' | 'en panne' }

// Le serveur répond par chemin ; une analyse en panne répond 500 avec sa cause.
function fauxServeur({ alertes = [], analyse = 'ok' }: Serveur) {
  return (url: string) => {
    const reponse = (status: number, body: unknown) =>
      Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });
    if (url.startsWith('/alerts')) return reponse(200, { alerts: alertes, activeIds: [] });
    if (analyse === 'en panne') return reponse(500, { error: 'base illisible' });
    if (url.startsWith('/analysis/summary')) return reponse(200, resume);
    if (url.startsWith('/recommendations')) return reponse(200, { groups: [], stale: [], decided: [] });
    return reponse(404, { error: url });
  };
}

// Toutes les réponses du faux serveur sont déjà résolues : une tâche plus tard,
// la page a fini de les lire.
const laPageAFiniDeLire = () => new Promise(r => setImmediate(r));

async function ouvrirLaPage(serveur: Serveur) {
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
  vi.stubGlobal('fetch', fauxServeur(serveur));
  vi.resetModules();
  const { initAdvisor } = await import('../../src/web/observatory/advisor-view.ts');
  initAdvisor();
  noeuds.get('btn-advisor').click();
  await laPageAFiniDeLire();
  return { noeud: (id: string) => noeuds.get(id), fenetre };
}

afterEach(() => { vi.unstubAllGlobals(); });

const compteur = (page: Awaited<ReturnType<typeof ouvrirLaPage>>, libelle: string) =>
  parClasse(page.noeud('advisor-tabs'), 'advisor-counter').find(c => texte(c).includes(libelle));

test('une panne a traiter : l onglet Pannes s ouvre, son compteur est souligne, Conseils est cache', async () => {
  // Arrange
  const serveur = { alertes: [panne] };
  // Act
  const page = await ouvrirLaPage(serveur);
  // Assert
  expect(page.noeud('advisor-tab-pannes').hidden).toBe(false);
  expect(page.noeud('advisor-tab-conseils').hidden).toBe(true);
  expect(compteur(page, 'pannes à traiter').classList.contains('is-active')).toBe(true);
});

test('aucune panne a traiter : l onglet Conseils s ouvre, Pannes est cache', async () => {
  // Arrange
  const serveur = { alertes: [] };
  // Act
  const page = await ouvrirLaPage(serveur);
  // Assert
  expect(page.noeud('advisor-tab-conseils').hidden).toBe(false);
  expect(page.noeud('advisor-tab-pannes').hidden).toBe(true);
});

test('l onglet choisi reste ouvert quand la fin d une analyse redessine la page', async () => {
  // Arrange
  const page = await ouvrirLaPage({ alertes: [panne] });
  compteur(page, 'conseils à traiter').click();
  // Act
  page.fenetre['agentviz:analysisScan']!({ detail: { phase: 'done', total: 1, scanned: 1, skipped: 0, failed: 0 } });
  await laPageAFiniDeLire();
  // Assert
  expect(page.noeud('advisor-tab-conseils').hidden).toBe(false);
  expect(page.noeud('advisor-tab-pannes').hidden).toBe(true);
});

test('l onglet choisi reste ouvert quand on change de periode', async () => {
  // Arrange
  const page = await ouvrirLaPage({ alertes: [panne] });
  compteur(page, 'conseils à traiter').click();
  const sept = page.noeud('advisor-period').children.find((b: any) => texte(b) === '7 j');
  // Act
  sept.click();
  await laPageAFiniDeLire();
  // Assert
  expect(page.noeud('advisor-tab-conseils').hidden).toBe(false);
  expect(page.noeud('advisor-tab-pannes').hidden).toBe(true);
});

test('a l ouverture, le detail de la periode est replie', async () => {
  // Arrange
  const serveur = { alertes: [] };
  // Act
  const page = await ouvrirLaPage(serveur);
  // Assert
  const [detail] = parClasse(page.noeud('advisor-summary'), 'advisor-period-details');
  expect(detail.tagName).toBe('DETAILS');
  expect(detail.open).toBe(false);
});

test('analyse indisponible : la page le dit, sans phrase-bilan ni compteurs, et Pannes reste visible', async () => {
  // Arrange
  const serveur = { alertes: [panne], analyse: 'en panne' as const };
  // Act
  const page = await ouvrirLaPage(serveur);
  // Assert
  expect(texte(page.noeud('advisor-summary'))).toBe('Analyse indisponible : base illisible');
  expect(texte(page.noeud('advisor-bilan'))).toBe('');
  expect(page.noeud('advisor-tabs').children.length).toBe(0);
  expect(page.noeud('advisor-tab-pannes').hidden).toBe(false);
  expect(page.noeud('advisor-tab-conseils').hidden).toBe(true);
});

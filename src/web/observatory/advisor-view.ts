// advisor-view.js — "Conseils" page.
//
// Rendering only: ranking is done server-side, wording by evidence.js, numbers
// by format.js, state by store.js. One block per cost basis, each saying it is
// not comparable with the other — and no total anywhere, because a same
// session feeds several rules.

import * as api from './api.ts';
import { getState, subscribe, loadAdvisor, changeStatus, applyScanEvent } from './store.ts';
import {
  confidenceLabel, costLabel, basisTitle, periodLabel, basisLabel, periodHeader,
  scanProgressLabel, summaryHeadline, summaryDetails, returnBanner,
  type Recommendation, type Summary, type ScanProgress,
} from './format.ts';
import { evidenceLines } from './evidence.ts';
import { initPeriodSelector } from './period-selector.ts';
import { initConfirmButton } from './confirm-button.ts';
import { renderFailures } from './failures-view.ts';
import { renderDecisions, refusalControls } from './decisions-view.ts';
import type { JournalAlert } from './failures-format.ts';

// Le client HTTP tel qu'importe ici (`import * as api`) — meme motif que
// store.ts (non exporte de la, un alias local par consommateur).
type ApiClient = typeof import('./api.ts');

// Ce que le magasin rend pour la liste (store.ts type `recommendations` en
// `unknown` : ce fichier est celui qui sait lire sa forme reelle).
interface RecommendationGroups {
  groups: { basis: string; priority: Recommendation[]; all: Recommendation[] }[];
  stale: Recommendation[];
  decided: Recommendation[];
}

function el(tag: string, className?: string | null, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// Les trois intentions (doc/44) : chaque bouton répond à « Que fais-tu de ce
// conseil ? » dans les mots de l'utilisateur, et sa conséquence est écrite
// dessous — le contrat au moment du clic, pas dans un mode d'emploi ailleurs.

// Cles litterales, pas Record<string, string> : `status` (plus bas) ne vaut
// jamais que 'accepted' ou 'ignored' — l'indexation par une clef connue.
const CHOICE_CAPTIONS = {
  accepted: 'La carte part au journal. Si le coût regrossit malgré tout, elle reviendra te demander si le geste a vraiment pris.',
  ignored: 'Revient d’elle-même si le coût regrossit de moitié.',
  refuse: 'Dis pourquoi en une ligne ; c’est consigné au journal et ne sera plus proposé.',
};

function choice(content: HTMLElement, caption: string) {
  const wrap = el('div', 'advisor-choice');
  wrap.append(content, el('div', 'advisor-choice-caption', caption));
  return wrap;
}

// Exported for its tests: the card IS the page's contract with the user —
// the labels and captions are behavior here, not decoration.
export function recommendationCard(rec: Recommendation, { actionable }: { actionable: boolean }) {
  const card = el('div', 'advisor-card');
  card.dataset.recId = String(rec.id);
  card.appendChild(el('div', 'advisor-card-title', rec.title));
  // Une carte décidée qui re-surface dit son histoire avant ses mesures :
  // le statut choisit le bandeau (adoption interpellée, veille constatée).
  const banner = returnBanner(rec);
  if (banner) card.appendChild(el('div', 'advisor-card-return', banner));
  card.append(
    el('div', 'advisor-card-meta', `${confidenceLabel(rec.confidence)} · ${costLabel(rec)}`),
    el('div', 'advisor-card-period', periodLabel(rec)),
    el('div', 'advisor-card-action', rec.action
      ?? 'Aucun geste recommandé : la cause mesurée n’a pas de remède identifié — carte informative.'),
  );

  const evidence = el('ul', 'advisor-card-evidence');
  for (const line of evidenceLines(rec)) evidence.appendChild(el('li', null, line));
  card.appendChild(evidence);

  if (actionable) {
    // « Je l'adopte » n'existe que s'il y a un geste à adopter ; une carte
    // informative peut toujours être mise en veille ou refusée.
    const entries: ['accepted' | 'ignored', string][] = rec.action == null
      ? [['ignored', 'Plus tard']]
      : [['accepted', 'Je l’adopte'], ['ignored', 'Plus tard']];
    const buttons = el('div', 'advisor-card-buttons');
    for (const [status, label] of entries) {
      const btn = el('button', 'obs-btn', label) as HTMLButtonElement;
      btn.type = 'button';
      btn.dataset.status = status;
      buttons.appendChild(choice(btn, CHOICE_CAPTIONS[status]));
    }
    // « Non merci » : câblé avec sa raison (doc/42) — il ne passe pas par la
    // délégation data-status, qui partirait au serveur sans raison.
    buttons.appendChild(choice(
      refusalControls(reason => changeStatus(api, rec.id, 'arbitrated', reason)),
      CHOICE_CAPTIONS.refuse));
    card.appendChild(buttons);
  }
  return card;
}

function renderSummary(node: HTMLElement, summary: Summary | null | undefined) {
  node.textContent = '';
  if (!summary) return;
  node.append(
    el('div', 'advisor-summary-headline', summaryHeadline(summary)),
    el('div', 'advisor-summary-period', periodHeader(summary.period)),
    el('div', 'advisor-summary-basis', basisLabel(summary.basis)),
    el('div', 'advisor-summary-details', summaryDetails(summary)),
  );
}

function renderList(node: HTMLElement, { groups, stale, decided }: RecommendationGroups) {
  node.textContent = '';
  if (groups.length === 0 && stale.length === 0 && decided.length === 0) {
    node.appendChild(el('div', 'advisor-empty', 'Aucune recommandation sur la période — rien à corriger.'));
    return;
  }
  if (groups.length || stale.length) {
    node.appendChild(el('div', 'advisor-section-title', 'Inefficacités observées'));
  }
  for (const group of groups) {
    node.appendChild(el('div', 'advisor-basis-title', basisTitle(group.basis)));
    for (const rec of group.priority) node.appendChild(recommendationCard(rec, { actionable: true }));
    const rest = group.all.filter(r => !group.priority.some(p => p.id === r.id));
    if (rest.length) {
      node.appendChild(el('div', 'advisor-rest-title', `Autres observations (${rest.length})`));
      for (const rec of rest) node.appendChild(recommendationCard(rec, { actionable: true }));
    }
  }
  if (stale.length) {
    node.appendChild(el('div', 'advisor-rest-title',
      `Ne se produit plus depuis la dernière analyse (${stale.length})`));
    for (const rec of stale) node.appendChild(recommendationCard(rec, { actionable: false }));
  }
  // Dernière section, repliée mais jamais silencieuse : le compte reste
  // visible depuis la vue principale, la décision et sa date dans le dépliage.
  renderDecisions(node, decided);
}

function render() {
  const state = getState();
  const head = document.getElementById('advisor-summary')!;
  const list = document.getElementById('advisor-list')!;
  if (state.error) {
    head.textContent = `Analyse indisponible : ${state.error}`;
    list.textContent = '';
    return;
  }
  if (state.loading && !state.summary) { head.textContent = 'Analyse en cours…'; return; }
  // state.summary/state.recommendations restent `unknown` cote magasin
  // (store.ts) : ce module est celui qui sait lire leur forme reelle.
  renderSummary(head, state.summary as Summary | null);
  const progress = scanProgressLabel(state.scan);
  if (progress) head.appendChild(el('div', 'advisor-scan-progress', progress));
  renderList(list, state.recommendations as RecommendationGroups);
}

// L'acquittement d'un groupe : la route est unitaire, la serie est ici.
// Sequentiel a dessein — un journal en ajout seul n'a rien a gagner a la
// concurrence, et l'ordre rend l'interruption lisible : tout ce qui precede
// l'erreur est acquitte, rien apres.
export async function ackEpisodes(apiClient: ApiClient, episodes: JournalAlert[]) {
  for (const a of episodes.filter(e => !e.acknowledged)) {
    await apiClient.acknowledgeAlert({ id: a.id, createdAt: a.createdAt });
  }
}

// Les pannes ne passent pas par le magasin de l'observatoire : elles viennent
// du chien de garde. Une erreur s'AFFICHE sans effacer la liste deja rendue —
// un bloc vide sans un mot serait indiscernable de « aucune panne », le pire
// mode de panne du seul panneau charge de dire qu'il y en a eu (doc/32).
async function loadFailures() {
  const node = document.getElementById('advisor-failures')!;
  const erreur = document.getElementById('advisor-failures-error')!;
  try {
    // Le type non verifie de fetchAlerts (getJson, api.ts) est repris ici :
    // c'est le point de lecture qui doit dire la vraie forme du payload.
    const { alerts } = await api.fetchAlerts({ days: getState().periodDays }) as { alerts: JournalAlert[] };
    erreur.textContent = '';
    renderFailures(node, alerts, {
      onAckGroup: episodes => ackEpisodes(api, episodes).then(
        () => loadFailures(),
        // L'etat vrai d'abord, le message ensuite : recharge PUIS pose le
        // motif d'interruption — l'ordre inverse le faisait effacer par le
        // chemin de succes du rechargement (revue finale doc/32).
        err => loadFailures().finally(() => {
          erreur.textContent = `Acquittement interrompu : ${(err as Error).message}`;
        }),
      ),
    });
  } catch (err) {
    erreur.textContent = `Pannes indisponibles : ${(err as Error).message}`;
  }
}

export function initAdvisor() {
  const panel = document.getElementById('advisor-overlay')!;
  subscribe(() => { if (panel.classList.contains('visible')) render(); });

  initPeriodSelector(document.getElementById('advisor-period')!, () => {
    loadAdvisor(api);
    loadFailures();
  });

  document.getElementById('btn-advisor')!.addEventListener('click', () => {
    panel.classList.toggle('visible');
    if (panel.classList.contains('visible')) { loadAdvisor(api); loadFailures(); }
  });

  document.getElementById('advisor-close')!.addEventListener('click', () => {
    panel.classList.remove('visible');
  });

  document.getElementById('advisor-rescan')!.addEventListener('click', () => {
    api.requestScan({ days: getState().periodDays }).catch(() => {
      /* progress and errors arrive on the SSE stream */
    });
  });

  // Purge = the documented file deletion done from inside, behind a two-step
  // confirmation; the rebuild scan reports its progress on the SSE stream.
  initConfirmButton(document.getElementById('advisor-purge')!, {
    armedLabel: 'Confirmer la purge ?',
    onConfirm: () => {
      api.requestPurge({ days: getState().periodDays }).catch(() => {
        /* progress and errors arrive on the SSE stream */
      });
    },
  });

  document.getElementById('advisor-list')!.addEventListener('click', e => {
    const btn = (e.target as HTMLElement).closest('button[data-status]') as HTMLElement | null;
    if (!btn) return;
    const card = btn.closest('.advisor-card') as HTMLElement;
    changeStatus(api, Number(card.dataset.recId), btn.dataset.status as string);
  });

  // The scan broadcasts its progress on the existing SSE stream; reload when
  // it finishes so the page never shows advice from before the rescan.
  window.addEventListener('agentviz:analysisScan', e => {
    const detail = (e as CustomEvent<ScanProgress>).detail;
    applyScanEvent(detail);
    if (detail.phase === 'done' && panel.classList.contains('visible')) {
      loadAdvisor(api);
      loadFailures();
    }
  });
}

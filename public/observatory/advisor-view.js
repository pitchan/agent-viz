// advisor-view.js — "Conseils" page.
//
// Rendering only: ranking is done server-side, wording by evidence.js, numbers
// by format.js, state by store.js. One block per cost basis, each saying it is
// not comparable with the other — and no total anywhere, because a same
// session feeds several rules.

import * as api from './api.js';
import { getState, subscribe, loadAdvisor, changeStatus, applyScanEvent } from './store.js';
import {
  formatUsd, formatTokens, confidenceLabel, costLabel, basisTitle, periodLabel, basisLabel, periodHeader,
  scanProgressLabel,
} from './format.js';
import { evidenceLines } from './evidence.js';
import { initPeriodSelector } from './period-selector.js';
import { initConfirmButton } from './confirm-button.js';
import { renderFailures } from './failures-view.js';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function recommendationCard(rec, { actionable }) {
  const card = el('div', 'advisor-card');
  card.dataset.recId = String(rec.id);
  card.append(
    el('div', 'advisor-card-title', rec.title),
    el('div', 'advisor-card-meta', `${confidenceLabel(rec.confidence)} · ${costLabel(rec)}`),
    el('div', 'advisor-card-period', periodLabel(rec)),
    el('div', 'advisor-card-action', rec.action
      ?? 'Aucun geste recommandé : la cause mesurée n’a pas de remède identifié — carte informative.'),
  );

  const evidence = el('ul', 'advisor-card-evidence');
  for (const line of evidenceLines(rec)) evidence.appendChild(el('li', null, line));
  card.appendChild(evidence);

  if (actionable) {
    // 'J'applique' only exists when there is a gesture to apply; an
    // informative card can still be dismissed.
    const entries = rec.action == null
      ? [['ignored', 'Ignorer']]
      : [['accepted', 'J’applique'], ['ignored', 'Ignorer']];
    const buttons = el('div', 'advisor-card-buttons');
    for (const [status, label] of entries) {
      const btn = el('button', null, label);
      btn.type = 'button';
      btn.dataset.status = status;
      buttons.appendChild(btn);
    }
    card.appendChild(buttons);
  }
  return card;
}

function renderSummary(node, summary) {
  node.textContent = '';
  if (!summary) return;
  node.append(
    el('div', 'advisor-summary-period', periodHeader(summary.period)),
    el('div', 'advisor-summary-basis', basisLabel(summary.basis)),
  );
  const partial = summary.costComplete ? '' : ' · coût partiel';
  node.appendChild(el('div', null, `${summary.sessions} sessions · ${formatUsd(summary.costUsd)}`
    + ` · ${formatTokens(summary.netTokens)} jetons nets`
    + ` · ${formatTokens(summary.cacheReadTokens)} relus depuis le cache${partial}`
    + ` · prix : ${summary.priceSource}`));
}

function renderList(node, { groups, stale }) {
  node.textContent = '';
  if (groups.length === 0 && stale.length === 0) {
    node.appendChild(el('div', 'advisor-empty', 'Aucune recommandation sur la période — rien à corriger.'));
    return;
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
}

function render() {
  const state = getState();
  const head = document.getElementById('advisor-summary');
  const list = document.getElementById('advisor-list');
  if (state.error) {
    head.textContent = `Analyse indisponible : ${state.error}`;
    list.textContent = '';
    return;
  }
  if (state.loading && !state.summary) { head.textContent = 'Analyse en cours…'; return; }
  renderSummary(head, state.summary);
  const progress = scanProgressLabel(state.scan);
  if (progress) head.appendChild(el('div', 'advisor-scan-progress', progress));
  renderList(list, state.recommendations);
}

// Les pannes ne passent pas par le magasin de l'observatoire : elles ne
// viennent pas du scan, elles viennent du chien de garde. Un chargement
// separe, une erreur qui ne prend pas le tiroir en otage.
async function loadFailures() {
  const node = document.getElementById('advisor-failures');
  try {
    const { alerts } = await api.fetchAlerts({ days: getState().periodDays });
    renderFailures(node, alerts);
  } catch {
    node.textContent = '';
  }
}

export function initAdvisor() {
  const panel = document.getElementById('advisor-overlay');
  subscribe(() => { if (panel.classList.contains('visible')) render(); });

  initPeriodSelector(document.getElementById('advisor-period'), () => {
    loadAdvisor(api);
    loadFailures();
  });

  document.getElementById('btn-advisor').addEventListener('click', () => {
    panel.classList.toggle('visible');
    if (panel.classList.contains('visible')) { loadAdvisor(api); loadFailures(); }
  });

  document.getElementById('advisor-close').addEventListener('click', () => {
    panel.classList.remove('visible');
  });

  document.getElementById('advisor-rescan').addEventListener('click', () => {
    api.requestScan({ days: getState().periodDays }).catch(() => {
      /* progress and errors arrive on the SSE stream */
    });
  });

  // Purge = the documented file deletion done from inside, behind a two-step
  // confirmation; the rebuild scan reports its progress on the SSE stream.
  initConfirmButton(document.getElementById('advisor-purge'), {
    armedLabel: 'Confirmer la purge ?',
    onConfirm: () => {
      api.requestPurge({ days: getState().periodDays }).catch(() => {
        /* progress and errors arrive on the SSE stream */
      });
    },
  });

  document.getElementById('advisor-list').addEventListener('click', e => {
    const btn = e.target.closest('button[data-status]');
    if (!btn) return;
    changeStatus(api, Number(btn.closest('.advisor-card').dataset.recId), btn.dataset.status);
  });

  // The scan broadcasts its progress on the existing SSE stream; reload when
  // it finishes so the page never shows advice from before the rescan.
  window.addEventListener('agentviz:analysisScan', e => {
    applyScanEvent(e.detail);
    if (e.detail.phase === 'done' && panel.classList.contains('visible')) {
      loadAdvisor(api);
      loadFailures();
    }
  });
}

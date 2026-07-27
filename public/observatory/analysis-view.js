// analysis-view.js — "Sessions analysées" page: the SQLite-backed table with a
// per-session drill-down.
//
// Distinct from the real-time /sessions list, which enumerates event files in
// the temp directory. Both are kept: one shows what is happening, this one
// shows what was measured — and each names its own price source, because they
// do not use the same one.

import * as api from './api.js';
import { getState, subscribe, loadAnalysis, loadSession } from './store.js';
import { formatUsd, formatTokens, formatBytes, formatDuration } from './format.js';

const HEADERS = ['Session', 'Projet', 'Modèle', 'Coût', 'Jetons nets', 'Durée'];

export function sessionRow(session) {
  return [
    session.id.slice(0, 8),
    session.project,
    session.modelMain || '—',
    session.costComplete ? formatUsd(session.costUsd) : `${formatUsd(session.costUsd)} (partiel)`,
    formatTokens(session.netTokens),
    formatDuration(session.startedAt, session.endedAt),
  ];
}

// Only lines carrying a non-zero number are shown: a wall of zeros hides the
// one figure that matters. Net tokens and cache reads stay on separate lines —
// they are not the same thing and are never added.
export function drillDownLines(report) {
  const lines = [
    `${report.netTokens} jetons nets, ${report.tokens.total.cacheRead} jetons relus depuis le cache`,
  ];
  if (report.context.cacheChurnTokens > 0) {
    lines.push(`${report.context.cacheChurnTokens} jetons de contexte reconstruit,`
      + ` dont ${report.context.churnCauses.prefixChange.tokens} par préfixe modifié`);
  }
  if (report.context.compactions.length > 0) {
    lines.push(`${report.context.compactions.length} compactions`);
  }
  if (report.toolResults.totalResults > 0) {
    lines.push(`${report.toolResults.totalResults} sorties d’outils, ${formatBytes(report.toolResults.totalBytes)} au total`);
  }
  if (report.reads.cases.crossAgentDuplicate.bytes > 0) {
    lines.push(`${formatBytes(report.reads.cases.crossAgentDuplicate.bytes)} relus par un autre agent`);
  }
  if (report.subagents.spawnToolUses > 0) {
    lines.push(`${report.subagents.spawnToolUses} sous-agents lancés, ${report.subagents.sidecarCount} fichiers de trace`);
  }
  if (report.parseErrors > 0) {
    const n = report.parseErrors;
    lines.push(`${n} ligne${n > 1 ? 's' : ''} non analysable${n > 1 ? 's' : ''}`);
  }
  return lines;
}

function buildTable(sessions) {
  const table = document.createElement('table');
  table.className = 'analysis-table';
  const head = document.createElement('tr');
  for (const label of HEADERS) {
    const th = document.createElement('th');
    th.textContent = label;
    head.appendChild(th);
  }
  table.appendChild(head);
  for (const session of sessions) {
    const tr = document.createElement('tr');
    tr.dataset.sessionId = session.id;
    for (const cell of sessionRow(session)) {
      const td = document.createElement('td');
      td.textContent = cell;
      tr.appendChild(td);
    }
    table.appendChild(tr);
  }
  return table;
}

function render() {
  const state = getState();
  const head = document.getElementById('analysis-summary');
  const list = document.getElementById('analysis-list');
  const detail = document.getElementById('analysis-detail');

  if (state.error) { head.textContent = `Analyse indisponible : ${state.error}`; return; }
  head.textContent = state.sessions.length
    ? `${state.sessions.length} sessions analysées — cliquer une ligne pour le détail`
    : 'Aucune session analysée sur la période.';
  list.textContent = '';
  if (state.sessions.length) list.appendChild(buildTable(state.sessions));

  detail.textContent = '';
  if (state.selectedSession) {
    const { report, priceSource } = state.selectedSession;
    const title = document.createElement('div');
    title.className = 'analysis-detail-title';
    title.textContent = `${report.sessionId} — prix : ${priceSource}`;
    const ul = document.createElement('ul');
    for (const line of drillDownLines(report)) {
      const li = document.createElement('li');
      li.textContent = line;
      ul.appendChild(li);
    }
    detail.append(title, ul);
  }
}

export function initAnalysis() {
  const panel = document.getElementById('analysis-overlay');
  subscribe(() => { if (panel.classList.contains('visible')) render(); });

  document.getElementById('btn-analysis').addEventListener('click', () => {
    panel.classList.toggle('visible');
    if (panel.classList.contains('visible')) loadAnalysis(api);
  });

  document.getElementById('analysis-close').addEventListener('click', () => {
    panel.classList.remove('visible');
  });

  document.getElementById('analysis-list').addEventListener('click', e => {
    const row = e.target.closest('tr[data-session-id]');
    if (row) loadSession(api, row.dataset.sessionId);
  });
}

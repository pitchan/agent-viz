// analysis-view.ts — "Sessions analysées" page: the SQLite-backed table with a
// per-session drill-down.
//
// Distinct from the real-time /sessions list, which enumerates event files in
// the temp directory. Both are kept: one shows what is happening, this one
// shows what was measured — and each names its own price source, because they
// do not use the same one.

import * as api from './api.ts';
import { getState, subscribe, loadAnalysis, loadSession, setIncludeMachine } from './store.ts';
import { formatUsd, formatTokens, formatBytes, formatDuration, basisLabel, periodHeader, type Summary } from './format.ts';
import { initPeriodSelector } from './period-selector.ts';

// Une ligne de GET /analysis/sessions — projectPath/project calqués sur
// SessionListRow (service.ts, jamais importé : frontière navigateur/Node).
// `null` = ligne antérieure à M1.1, jamais une valeur devinée.
interface SessionSummaryRow {
  id: string;
  projectPath: string | null;
  project: string | null;
  modelMain?: string | null;
  costComplete?: boolean;
  costUsd: number;
  netTokens: number;
  startedAt?: string | null;
  endedAt?: string | null;
  sessionKind?: 'interactive' | 'headless' | 'unknown' | null;
}

// Le rapport détaillé d'UNE session (drill-down), sous-ensemble du rapport
// du moteur (src/engine — jamais importé ici, frontière navigateur/Node,
// doc/36 §2) reduit aux champs que ce panneau affiche.
interface SessionReport {
  sessionId: string;
  netTokens: number;
  tokens: { total: { cacheRead: number } };
  context: {
    cacheChurnTokens: number;
    churnCauses: { prefixChange: { tokens: number } };
    compactions: unknown[];
  };
  toolResults: { totalResults: number; totalBytes: number };
  reads: { cases: { crossAgentDuplicate: { bytes: number } } };
  subagents: { spawnToolUses: number; sidecarCount: number };
  parseErrors: number;
}

interface SelectedSession {
  report: SessionReport;
  priceSource: string;
}

const HEADERS = ['Session', 'Projet', 'Modèle', 'Coût', 'Jetons nets', 'Durée', 'Type'];

// A null kind is a pre-migration row (scanned before sessionKind existed):
// it is shown as unknown, never as human.
const KIND_BADGE = { interactive: 'humain', headless: 'machine', unknown: '?' };
const kindBadgeOf = (kind: string | null | undefined) => KIND_BADGE[kind as 'interactive' | 'headless' | 'unknown'] ?? '?';

export function sessionRow(session: SessionSummaryRow) {
  return [
    session.id.slice(0, 8),
    // Le vrai chemin de travail quand le service a su le lire ; le slug encodé
    // par Claude Code sinon — jamais une cellule vide.
    session.projectPath || session.project,
    session.modelMain || '—',
    session.costComplete ? formatUsd(session.costUsd) : `${formatUsd(session.costUsd)} (partiel)`,
    formatTokens(session.netTokens),
    formatDuration(session.startedAt, session.endedAt),
    kindBadgeOf(session.sessionKind),
  ];
}

// Only lines carrying a non-zero number are shown: a wall of zeros hides the
// one figure that matters. Net tokens and cache reads stay on separate lines —
// they are not the same thing and are never added.
export function drillDownLines(report: SessionReport) {
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

function buildTable(sessions: SessionSummaryRow[]) {
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
    const cells = sessionRow(session);
    cells.forEach((cell, i) => {
      const td = document.createElement('td');
      td.textContent = cell;
      // Last cell is the kind badge — style it from the session, not the
      // formatted string, since 'humain'/'machine'/'?' alone can't carry it.
      if (i === cells.length - 1) td.className = `kind-badge kind-${session.sessionKind ?? 'unknown'}`;
      tr.appendChild(td);
    });
    table.appendChild(tr);
  }
  return table;
}

function render() {
  const state = getState();
  const head = document.getElementById('analysis-summary')!;
  const list = document.getElementById('analysis-list')!;
  const detail = document.getElementById('analysis-detail')!;

  if (state.error) { head.textContent = `Analyse indisponible : ${state.error}`; return; }
  // state.sessions/state.summary/state.selectedSession restent `unknown` cote
  // magasin (store.ts) : ce module est celui qui sait lire leur forme reelle.
  const sessions = state.sessions as SessionSummaryRow[];
  const summary = state.summary as Summary | null;
  head.textContent = sessions.length
    ? [
        `${sessions.length} sessions affichées — cliquer une ligne pour le détail`,
        summary?.period ? periodHeader(summary.period) : '',
        summary?.basis ? basisLabel(summary.basis) : '',
      ].filter(Boolean).join(' — ')
    : 'Aucune session analysée sur la période.';
  list.textContent = '';
  if (sessions.length) list.appendChild(buildTable(sessions));

  detail.textContent = '';
  const selectedSession = state.selectedSession as SelectedSession | null;
  if (selectedSession) {
    const { report, priceSource } = selectedSession;
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
  const panel = document.getElementById('analysis-overlay')!;
  subscribe(() => { if (panel.classList.contains('visible')) render(); });

  initPeriodSelector(document.getElementById('analysis-period')!, () => loadAnalysis(api));

  document.getElementById('analysis-include-machine')!.addEventListener('change', e => {
    setIncludeMachine((e.target as HTMLInputElement).checked);
    loadAnalysis(api);
  });

  document.getElementById('btn-analysis')!.addEventListener('click', () => {
    panel.classList.toggle('visible');
    if (panel.classList.contains('visible')) loadAnalysis(api);
  });

  document.getElementById('analysis-close')!.addEventListener('click', () => {
    panel.classList.remove('visible');
  });

  document.getElementById('analysis-list')!.addEventListener('click', e => {
    const row = (e.target as HTMLElement).closest('tr[data-session-id]') as HTMLElement | null;
    if (row) loadSession(api, row.dataset.sessionId as string);
  });
}

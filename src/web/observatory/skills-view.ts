// skills-view.ts — « Skills » page: an indicative reading of how often each
// skill served when it was offered, with the cost Claude Code attributes to it.
//
// Rendering only, on the pricing-view.ts model: state comes from store.ts,
// data from api.ts.

import * as api from './api.ts';
import { getState, subscribe, loadSkills } from './store.ts';
import { formatUsdExact, basisLabel, periodHeader, type Period, type SummaryBasis } from './format.ts';
import { initPeriodSelector } from './period-selector.ts';

// Les champs de GET /analysis/skills que ce panneau lit (SkillUsageRow,
// skill-usage.ts, jamais importé : frontière navigateur/Node).
interface SkillUsageRow {
  skill: string;
  offeredSessions: number;
  usedSessions: number;
  usedShare: number;
  usd: number | null;
}

interface SkillUsagePayload {
  skills: SkillUsageRow[];
  sessionsCounted: number;
  excludedPendingRescan: number;
  period?: Period | null;
  basis?: SummaryBasis | null;
}

const HEADERS = ['Skill', 'Usage', 'Coût attribué'];

// La définition affichée sous le tableau : c'est l'attribution de Claude Code,
// reprise telle quelle, avec ce qu'elle ne couvre pas.
const COST_DEFINITION = 'Coût attribué : le tour où le skill est lancé et les sous-agents de ce tour, '
  + 'tels que Claude Code les marque (attributionSkill). Les tours suivants ne lui sont pas comptés.';

// « 0 % » est réservé au skill jamais utilisé : un skill qui a servi et qui
// s'arrondirait à 0 se lit « < 1 % ».
export function usageCellOf(row: Pick<SkillUsageRow, 'usedShare'>) {
  if (row.usedShare === 0) return '0 %';
  const percent = Math.round(row.usedShare * 100);
  return percent === 0 ? '< 1 %' : `${percent} %`;
}

export function usageTitleOf(row: Pick<SkillUsageRow, 'usedSessions' | 'offeredSessions'>) {
  return `${row.usedSessions} sessions sur ${row.offeredSessions} où il était proposé`;
}

export function skillCostCellOf(row: Pick<SkillUsageRow, 'usedSessions' | 'usd'>) {
  if (row.usedSessions === 0) return '—';
  return row.usd === null ? 'tarif inconnu' : formatUsdExact(row.usd);
}

export function splitByUse<T extends Pick<SkillUsageRow, 'usedSessions'>>(rows: T[]) {
  return { used: rows.filter(r => r.usedSessions > 0), unused: rows.filter(r => r.usedSessions === 0) };
}

export function unusedTitle(count: number) {
  return `Jamais utilisés (${count})`;
}

function headerRow() {
  const tr = document.createElement('tr');
  for (const label of HEADERS) {
    const th = document.createElement('th');
    th.textContent = label;
    tr.appendChild(th);
  }
  return tr;
}

function buildTable(rows: SkillUsageRow[]) {
  const table = document.createElement('table');
  table.className = 'analysis-table';
  table.appendChild(headerRow());
  for (const row of rows) {
    const tr = document.createElement('tr');
    const cells = [row.skill, usageCellOf(row), skillCostCellOf(row)].map(text => {
      const td = document.createElement('td');
      td.textContent = text;
      return td;
    });
    cells[1]!.title = usageTitleOf(row);
    tr.append(...cells);
    table.appendChild(tr);
  }
  return table;
}

// Le panneau se redessine à chaque notification du magasin (scan, période) :
// le bloc garde l'état ouvert ou fermé que la personne lui a donné.
function unusedBlock(rows: SkillUsageRow[], open: boolean) {
  const details = document.createElement('details');
  details.className = 'skills-unused';
  details.open = open;
  const summary = document.createElement('summary');
  summary.textContent = unusedTitle(rows.length);
  details.append(summary, buildTable(rows));
  return details;
}

function note(text: string) {
  const p = document.createElement('p');
  p.className = 'pricing-note';
  p.textContent = text;
  return p;
}

function render() {
  const state = getState();
  const summaryEl = document.getElementById('skills-summary')!;
  const body = document.getElementById('skills-body')!;

  if (state.error) { summaryEl.textContent = `Analyse indisponible : ${state.error}`; return; }
  // state.skillUsage reste `unknown` côté magasin (store.ts) : ce module est celui
  // qui sait lire sa forme réelle.
  const usage = state.skillUsage as SkillUsagePayload | null;
  if (!usage) return;

  summaryEl.textContent = [
    usage.period ? periodHeader(usage.period) : '',
    usage.basis ? basisLabel(usage.basis) : '',
    `${usage.sessionsCounted} session(s) lue(s)`,
  ].filter(Boolean).join(' — ');

  const wasOpen = body.querySelector<HTMLDetailsElement>('details.skills-unused')?.open ?? false;
  const { used, unused } = splitByUse(usage.skills);
  body.textContent = '';
  body.appendChild(buildTable(used));
  if (unused.length > 0) body.appendChild(unusedBlock(unused, wasOpen));
  body.appendChild(note(COST_DEFINITION));
  if (usage.excludedPendingRescan > 0) {
    body.appendChild(note(`${usage.excludedPendingRescan} session(s) en attente de ré-analyse — exclues du tableau, jamais en silence.`));
  }
}

export function initSkills() {
  const panel = document.getElementById('skills-overlay')!;
  subscribe(() => { if (panel.classList.contains('visible')) render(); });

  initPeriodSelector(document.getElementById('skills-period')!, () => loadSkills(api));

  document.getElementById('btn-skills')!.addEventListener('click', () => {
    panel.classList.toggle('visible');
    if (panel.classList.contains('visible')) loadSkills(api);
  });

  document.getElementById('skills-close')!.addEventListener('click', () => {
    panel.classList.remove('visible');
  });
}

// skills-view.ts — « Skills » page: how often each skill served when it was offered.
// Usage only, never a cost: Claude Code marks one skill per message, so a turn that
// launches two skills, or a skill launched by a sub-agent, has no separable cost.

import * as api from './api.ts';
import { getState, subscribe, loadSkills, setSkillsProject, SKILLS_MAX_DAYS } from './store.ts';
import { basisLabel, periodHeader, type Period, type SummaryBasis } from './format.ts';
import { initPeriodSelector } from './period-selector.ts';

// Les champs de GET /analysis/skills que ce panneau lit (SkillUsageRow,
// skill-usage.ts, jamais importé : frontière navigateur/Node).
interface SkillUsageRow {
  skill: string;
  offeredSessions: number;
  usedSessions: number;
  usedShare: number;
}

interface ProjectOption {
  project: string;
  label: string;
  sessions: number;
}

interface SkillUsagePayload {
  skills: SkillUsageRow[];
  sessionsCounted: number;
  excludedPendingRescan: number;
  projects: ProjectOption[];
  period?: Period | null;
  basis?: SummaryBasis | null;
}

const HEADERS = ['Skill', 'Usage'];

// « 0 % » est réservé au skill jamais utilisé : un skill qui a servi et qui
// s'arrondirait à 0 se lit « < 1 % ».
export function usageCellOf(row: Pick<SkillUsageRow, 'usedShare'>) {
  if (row.usedShare === 0) return '0 %';
  const percent = Math.round(row.usedShare * 100);
  return percent === 0 ? '< 1 %' : `${percent} %`;
}

export function usageTitleOf(row: Pick<SkillUsageRow, 'usedSessions' | 'offeredSessions'>) {
  return `${row.usedSessions} session(s) sur ${row.offeredSessions} où il était proposé`;
}

export function splitByUse<T extends Pick<SkillUsageRow, 'usedSessions'>>(rows: T[]) {
  return { used: rows.filter(r => r.usedSessions > 0), unused: rows.filter(r => r.usedSessions === 0) };
}

export function unusedTitle(count: number) {
  return `Jamais utilisés (${count})`;
}

// Le fait certain, et lui seul : ces rapports n'ont pas les faits de skills. Une
// ré-analyse les rendrait — encore faut-il que le transcript existe toujours, et
// Claude Code l'efface après 30 jours. Rien ici ne promet donc qu'elle aura lieu.
export function excludedNote(count: number) {
  return `${count} session(s) de la période n'ont pas de données Skills `
    + '(analysées par une version antérieure) — exclues du tableau.';
}

// Le nombre de sessions lues colle au libellé : un projet à 3 sessions ne se lit
// pas comme un projet à 72, et le pourcentage du tableau en dépend.
export function projectOptionsOf(projects: ProjectOption[], selected: string | null) {
  return [
    { value: '', label: 'Tous les projets', selected: selected === null },
    ...projects.map(p => ({ value: p.project, label: `${p.label} (${p.sessions})`, selected: p.project === selected })),
  ];
}

// Le nombre lu doit dire ce qu'il compte : sans ça, il se lit à côté de la base
// de la fenêtre (qui décrit toute la période, pas le projet choisi) et invite
// une soustraction fausse entre les deux.
export function readCountLabel(sessionsCounted: number, project: string | null) {
  return project === null
    ? `${sessionsCounted} session(s) lue(s)`
    : `${sessionsCounted} session(s) lue(s) pour ce projet`;
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
    const cells = [row.skill, usageCellOf(row)].map(text => {
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

function renderProjects(usage: SkillUsagePayload) {
  const node = document.getElementById('skills-project')!;
  node.textContent = '';
  const select = document.createElement('select');
  select.id = 'skills-project-select';
  select.className = 'obs-select';
  const label = document.createElement('label');
  label.className = 'obs-field-label';
  label.htmlFor = select.id;
  label.textContent = 'Projet';
  for (const option of projectOptionsOf(usage.projects, getState().skillsProject)) {
    const el = document.createElement('option');
    el.value = option.value;
    el.textContent = option.label;
    el.selected = option.selected;
    select.appendChild(el);
  }
  select.addEventListener('change', () => {
    setSkillsProject(select.value === '' ? null : select.value);
    loadSkills(api);
  });
  node.append(label, select);
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
    readCountLabel(usage.sessionsCounted, state.skillsProject),
  ].filter(Boolean).join(' — ');
  renderProjects(usage);

  const wasOpen = body.querySelector<HTMLDetailsElement>('details.skills-unused')?.open ?? false;
  const { used, unused } = splitByUse(usage.skills);
  body.textContent = '';
  body.appendChild(buildTable(used));
  if (unused.length > 0) body.appendChild(unusedBlock(unused, wasOpen));
  if (usage.excludedPendingRescan > 0) {
    body.appendChild(note(excludedNote(usage.excludedPendingRescan)));
  }
}

export function initSkills() {
  const panel = document.getElementById('skills-overlay')!;
  subscribe(() => { if (panel.classList.contains('visible')) render(); });

  initPeriodSelector(document.getElementById('skills-period')!, () => loadSkills(api), SKILLS_MAX_DAYS);

  document.getElementById('btn-skills')!.addEventListener('click', () => {
    panel.classList.toggle('visible');
    if (panel.classList.contains('visible')) loadSkills(api);
  });

  document.getElementById('skills-close')!.addEventListener('click', () => {
    panel.classList.remove('visible');
  });
}

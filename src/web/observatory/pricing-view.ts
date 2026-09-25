// pricing-view.ts — « Jetons & tarifs » page: the per-model cost breakdown,
// the applied tariff sheet, and the provenance notice.
//
// Rendering only, on the analysis-view.ts model: state comes from store.ts,
// data from api.ts. The panel speaks with ONE voice — agent-viz and netgain
// are one product; it names its single price source and shows how every
// number is made.

import * as api from './api.ts';
import { getState, subscribe, loadPricing } from './store.ts';
import {
  formatTokens, formatUsdExact, formatUsdPerMTok, formatShare, modelLabel, adoptionNote,
  driftTitle, ratesPerMTok, vigieStatus, pendingReason, checkOutcome,
  basisLabel, periodHeader, fastCostCell, fastTotalNote, fastRatesCell, type Period, type SummaryBasis,
} from './format.ts';
import { initPeriodSelector } from './period-selector.ts';

// La ligne du tableau « par modèle » — un seau de jetons (memes quatre
// compteurs que TokenBucket, viz-state.ts, mais indexes ici par modele et
// jamais lus comme un cumul de session).
interface ModelCostRow {
  model: string;
  pricing: string;
  costUsd: number;
  fastUsd: number;
  bucket: { in: number; out: number; cacheCreate: number; cacheRead: number };
  netTokens: number;
  shareOfCost: number | null;
}

interface ModelCostsTotals {
  netTokens: number;
  costUsd: number;
  fastUsd: number;
  costComplete: boolean;
  cacheReadTokens: number;
}

// GET /analysis/models.
interface ModelCostsPayload {
  totals: ModelCostsTotals;
  models: ModelCostRow[];
  period?: Period | null;
  basis?: SummaryBasis | null;
  excludedPendingRescan: number;
}

interface TariffPeriod {
  until: string;
  prices: { input: number; output: number };
}

interface TariffEntry {
  model: string;
  label: string;
  current: { input: number; output: number; cacheCreate: number; cacheRead: number };
  maxInput: number;
  history: TariffPeriod[];
  fast: { input: number; output: number; cacheCreate: number; cacheRead: number } | null;
  adopted: { source: string; adoptedAt: string; from: string | null } | null;
}

interface ZeroCostEntry {
  model: string;
  reason: string;
}

interface PriceTable {
  source: string;
  entries: TariffEntry[];
  zeroCost: ZeroCostEntry[];
}

interface ProvenanceSection {
  titre: string;
  corps: string;
}

interface Provenance {
  sections: ProvenanceSection[];
  engineVersion: string;
  scanVersion: string | number;
  priceSource: string;
}

// Un tarif relevé par la vigie et pas encore appliqué (KnownDrift côté serveur).
interface PriceUpdate {
  model: string;
  kind: 'modele-nouveau' | 'tarif-different';
  official: { input: number; output: number; cacheCreate: number; cacheRead: number };
  embedded: { input: number; output: number; cacheCreate: number; cacheRead: number } | null;
  maxInput: number | null;
}

// GET /pricing.
interface PricingPayload {
  priceTable: PriceTable;
  provenance: Provenance;
  updates: { checkedAt: string | null; drifts: PriceUpdate[] };
}

const COST_HEADERS = ['Modèle', 'Entrée', 'Sortie', 'Création de cache',
  'Relecture de cache', 'Jetons nets', 'Coût', 'dont mode rapide', 'Part'];
const TARIFF_HEADERS = ['Modèle', 'Entrée', 'Sortie', 'Écriture cache 5 min',
  'Relecture', 'Mode rapide (entrée / sortie)', 'Fenêtre', 'Périodes datées'];

// "tarif inconnu" instead of an amount, a wanted zero says so with no shame:
// no silent cell, ever.
export function costCellOf(row: ModelCostRow) {
  if (row.pricing === 'inconnu') return 'tarif inconnu';
  if (row.pricing === 'zero-voulu') return '0,00 $ — non facturable';
  return formatUsdExact(row.costUsd);
}

function headerRow(labels: string[]) {
  const tr = document.createElement('tr');
  for (const label of labels) {
    const th = document.createElement('th');
    th.textContent = label;
    tr.appendChild(th);
  }
  return tr;
}

function cellRow(cells: string[], rawModelId: string) {
  const tr = document.createElement('tr');
  cells.forEach((cell, i) => {
    const td = document.createElement('td');
    td.textContent = cell;
    if (i === 0) td.title = rawModelId; // the raw id stays reachable
    tr.appendChild(td);
  });
  return tr;
}

function buildCostTable(models: ModelCostRow[]) {
  const table = document.createElement('table');
  table.className = 'analysis-table';
  table.appendChild(headerRow(COST_HEADERS));
  for (const row of models) {
    table.appendChild(cellRow([
      modelLabel(row.model),
      formatTokens(row.bucket.in), formatTokens(row.bucket.out),
      formatTokens(row.bucket.cacheCreate), formatTokens(row.bucket.cacheRead),
      formatTokens(row.netTokens),
      costCellOf(row),
      fastCostCell(row.fastUsd, row.pricing),
      row.shareOfCost === null ? '—' : formatShare(row.shareOfCost),
    ], row.model));
  }
  return table;
}

function periodsCell(history: TariffPeriod[]) {
  if (!history.length) return '—';
  return history
    .map(p => `jusqu’au ${p.until} : ${formatUsdPerMTok(p.prices.input)} entrée / ${formatUsdPerMTok(p.prices.output)} sortie`)
    .join(' ; ');
}

function buildTariffTable(priceTable: PriceTable) {
  const table = document.createElement('table');
  table.className = 'analysis-table';
  table.appendChild(headerRow(TARIFF_HEADERS));
  for (const e of priceTable.entries) {
    table.appendChild(cellRow([
      e.adopted ? `${e.label} (${adoptionNote(e.adopted)})` : e.label,
      formatUsdPerMTok(e.current.input), formatUsdPerMTok(e.current.output),
      formatUsdPerMTok(e.current.cacheCreate), formatUsdPerMTok(e.current.cacheRead),
      fastRatesCell(e.fast),
      formatTokens(e.maxInput),
      periodsCell(e.history),
    ], e.model));
  }
  return table;
}

function zeroCostList(zeroCost: ZeroCostEntry[]) {
  const ul = document.createElement('ul');
  ul.className = 'pricing-zero-cost';
  for (const z of zeroCost) {
    const li = document.createElement('li');
    li.textContent = `${z.model} : 0,00 $ — non facturable (${z.reason})`;
    ul.appendChild(li);
  }
  return ul;
}

function buildProvenanceBlock(provenance: Provenance) {
  const wrap = document.createElement('div');
  for (const s of provenance.sections) {
    const title = document.createElement('div');
    title.className = 'pricing-notice-title';
    title.textContent = s.titre;
    const body = document.createElement('p');
    body.className = 'pricing-notice-body';
    body.textContent = s.corps;
    wrap.append(title, body);
  }
  const meta = document.createElement('p');
  meta.className = 'pricing-notice-meta';
  // Le moteur est livré dans agent-viz : sa version est celle d'agent-viz.
  meta.textContent = `Moteur netgain (agent-viz v${provenance.engineVersion}) — analyse SCAN_VERSION ${provenance.scanVersion} — source des prix : ${provenance.priceSource}`;
  wrap.appendChild(meta);
  return wrap;
}

// Ce que la dernière vérification demandée a rencontré : le rechargement du panneau
// ne le porte pas, il vit le temps de la page.
let lastCheckNote: string | null = null;

// « Vérifier maintenant » : désactivé pendant l'appel, puis le panneau se recharge avec
// les tarifs appliqués ; un échec réseau se lit sur le bouton, avec la cause du serveur.
function checkButton() {
  const btn = document.createElement('button');
  btn.className = 'obs-btn';
  btn.textContent = 'Vérifier maintenant';
  btn.addEventListener('click', () => {
    btn.disabled = true;
    api.checkPrices()
      .then(r => { lastCheckNote = checkOutcome(r); return loadPricing(api); })
      .catch((err: unknown) => {
        btn.disabled = false;
        btn.textContent = `Échec : ${err instanceof Error ? err.message : String(err)}`;
      });
  });
  return btn;
}

// Chaque tarif relevé et pas appliqué se lit avec la raison de son attente.
function buildUpdatesBlock(updates: PricingPayload['updates']) {
  const wrap = document.createElement('div');
  wrap.className = 'pricing-updates';
  const status = document.createElement('p');
  status.className = 'pricing-note';
  status.textContent = vigieStatus(updates.checkedAt, updates.drifts.length);
  wrap.append(status, checkButton());
  if (lastCheckNote !== null) {
    const note = document.createElement('p');
    note.className = 'pricing-note';
    note.textContent = lastCheckNote;
    wrap.appendChild(note);
  }
  for (const d of updates.drifts) {
    const row = document.createElement('div');
    row.className = 'pricing-update';
    const text = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'pricing-notice-title';
    title.textContent = driftTitle(d);
    const rates = document.createElement('div');
    rates.textContent = `Anthropic, $ par million : ${ratesPerMTok(d.official)}`
      + (d.embedded ? ` — actuel : ${ratesPerMTok(d.embedded)}` : '');
    const reason = document.createElement('div');
    reason.textContent = pendingReason(d);
    text.append(title, rates, reason);
    row.appendChild(text);
    wrap.appendChild(row);
  }
  return wrap;
}

const blockTitle = (text: string) => {
  const div = document.createElement('div');
  div.className = 'advisor-basis-title';
  div.textContent = text;
  return div;
};

function render() {
  const state = getState();
  const summaryEl = document.getElementById('pricing-summary')!;
  const body = document.getElementById('pricing-body')!;

  if (state.error) { summaryEl.textContent = `Analyse indisponible : ${state.error}`; return; }
  // state.modelCosts/state.pricing restent `unknown` cote magasin (store.ts) :
  // ce module est celui qui sait lire leur forme reelle.
  const modelCosts = state.modelCosts as ModelCostsPayload | null;
  const pricing = state.pricing as PricingPayload | null;
  if (!modelCosts || !pricing) return;

  const { totals } = modelCosts;
  summaryEl.textContent = [
    modelCosts.period ? periodHeader(modelCosts.period) : '',
    modelCosts.basis ? basisLabel(modelCosts.basis) : '',
    `${formatTokens(totals.netTokens)} jetons nets — ${formatUsdExact(totals.costUsd)}${fastTotalNote(totals.fastUsd)}${totals.costComplete ? '' : ' (coût partiel)'}`,
    `${formatTokens(totals.cacheReadTokens)} jetons relus depuis le cache (jamais additionnés aux nets)`,
  ].filter(Boolean).join(' — ');

  body.textContent = '';
  body.append(
    blockTitle('Tarifs Anthropic'),
    buildUpdatesBlock(pricing.updates),
    blockTitle('Ventilation par modèle — la somme des lignes vaut le total, au centime'),
    buildCostTable(modelCosts.models));
  if (modelCosts.excludedPendingRescan > 0) {
    const note = document.createElement('p');
    note.className = 'pricing-note';
    note.textContent = `${modelCosts.excludedPendingRescan} session(s) en attente de ré-analyse — exclues des lignes ET du total ci-dessus, jamais en silence.`;
    body.appendChild(note);
  }
  body.append(
    blockTitle(`Barème appliqué (${pricing.priceTable.source} — affiché par million de jetons)`),
    buildTariffTable(pricing.priceTable),
    zeroCostList(pricing.priceTable.zeroCost),
    blockTitle('D’où viennent ces nombres'),
    buildProvenanceBlock(pricing.provenance));
}

export function initPricing() {
  const panel = document.getElementById('pricing-overlay')!;
  subscribe(() => { if (panel.classList.contains('visible')) render(); });

  initPeriodSelector(document.getElementById('pricing-period')!, () => loadPricing(api));

  document.getElementById('btn-pricing')!.addEventListener('click', () => {
    panel.classList.toggle('visible');
    if (panel.classList.contains('visible')) loadPricing(api);
  });

  document.getElementById('pricing-close')!.addEventListener('click', () => {
    panel.classList.remove('visible');
  });
}

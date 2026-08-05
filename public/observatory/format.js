// format.js — display helpers for the observatory pages.
//
// Pure functions only, no DOM at import time, so they can be unit-tested.
// formatTokens is NOT redefined here: viz-state.js already owns it and is
// importable under Node.

import { formatTokens } from '../viz-state.js';
export { formatTokens };

export function formatUsd(n) {
  return `${n.toFixed(2).replace('.', ',')} $`;
}

export function formatBytes(n) {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1).replace('.', ',')} Mo`;
  if (n >= 1024) return `${Math.round(n / 1024)} Ko`;
  return `${n} o`;
}

// "—" rather than "0 min": a session without timestamps has an unknown
// duration, not a null one.
export function formatDuration(startedAt, endedAt) {
  if (!startedAt || !endedAt) return '—';
  const ms = Date.parse(endedAt) - Date.parse(startedAt);
  if (Number.isNaN(ms) || ms < 0) return '—';
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`;
}

const CONFIDENCE_LABELS = { fait: 'Fait mesuré', correlation: 'Corrélation', hypothese: 'Hypothèse' };
export function confidenceLabel(c) {
  return CONFIDENCE_LABELS[c] || 'Inconnu';
}

const BASIS_LABELS = {
  'jetons-mesures': 'jetons mesurés',
  'octets-approx-4o-par-jeton': 'estimé depuis les octets (≈ 4 octets par jeton)',
};
export function costBasisLabel(basis) {
  return BASIS_LABELS[basis] || basis;
}

// When a card's dollars are partial (an unknown model in its sessions), the
// measured quantity leads and the dollars demote to a lower bound. One entry
// per rule, reusing the evidence keys the rules already persist; a rule
// without a quantity (R2) keeps the plain partial wording. Ranking is NOT
// affected: ordering tokens against dollars would break the homogeneity rule,
// so ranking.js keeps scoring the (lower-bound) dollars.
const LEAD_QUANTITY_BY_RULE = {
  R1: e => `${formatTokens(e.prefixChangeTokens)} jetons mesurés`,
  R5: e => `${formatTokens(e.reprocessedTokens)} jetons mesurés`,
  R6: e => `${formatTokens(e.subagentTokens)} jetons mesurés`,
  R3: e => `${formatBytes(e.bytes)} mesurés`,
  R4: e => `${formatBytes(e.duplicateBytes)} mesurés`,
};

export function costLabel(rec) {
  if (rec.evidence.costComplete === false) {
    const lead = LEAD_QUANTITY_BY_RULE[rec.ruleId];
    if (lead) {
      return `${lead(rec.evidence)} — dollars incomplets (au moins ${formatUsd(rec.estimatedCostUsd)}`
        + ' : un modèle sans tarif connu)';
    }
    return `${formatUsd(rec.estimatedCostUsd)} — ${costBasisLabel(rec.costBasis)}`
      + ' (coût partiel : un modèle sans tarif connu)';
  }
  return `${formatUsd(rec.estimatedCostUsd)} — ${costBasisLabel(rec.costBasis)}`;
}

// Heading of a cost-basis block. It exists to tell the reader that the two
// blocks are not comparable — the whole point of ranking them separately.
const BASIS_TITLES = {
  'jetons-mesures': 'Chiffré en jetons mesurés',
  'octets-approx-4o-par-jeton': 'Estimé depuis les octets — à ne pas comparer au bloc ci-dessus',
};
export function basisTitle(basis) {
  return BASIS_TITLES[basis] || basis;
}

/** JJ/MM local time — the observatory is a single-user local tool. */
export function formatDayMonth(iso) {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Every card states its window; a card without one says so, never guesses. */
export function periodLabel(rec) {
  if (!rec.periodFrom || !rec.periodTo) return 'période du constat non enregistrée (re-scanner)';
  return `constaté du ${formatDayMonth(rec.periodFrom)} au ${formatDayMonth(rec.periodTo)}`;
}

// Shared by both observatory pages (Conseils, Sessions analysées): one
// wording for the announced basis, not one per view.
export function basisLabel(basis) {
  if (!basis) return '';
  const { counts, includeMachine } = basis;
  const machines = includeMachine
    ? `${counts.headless} machines incluses · ${counts.unknown} indéterminées incluses`
    : `${counts.headless} machines exclues · ${counts.unknown} indéterminées exclues`;
  return `${counts.interactive} sessions humaines · ${machines}`;
}

export function periodHeader(period) {
  if (!period) return '';
  return `Fenêtre : ${period.days} j — du ${formatDayMonth(period.from)} au ${formatDayMonth(period.to)}`;
}

// Live wording for a running scan (SSE events): the answer to "nothing is
// moving" during the seconds between a purge/rescan click and its 'done'.
export function scanProgressLabel(scan) {
  if (!scan || scan.phase === 'done') return '';
  const handled = (scan.scanned ?? 0) + (scan.skipped ?? 0) + (scan.failed ?? 0);
  return `Analyse en cours — ${handled}/${scan.total ?? 0} sessions`;
}

// ─── « Jetons & tarifs » panel formatters ─────────────────────────────────

// USD per token → per-MTok wording, the unit rate cards are published in.
export function formatUsdPerMTok(perToken) {
  return `${(perToken * 1e6).toFixed(2).replace('.', ',')} $ le million`;
}

export function formatShare(ratio) {
  return `${(ratio * 100).toFixed(1).replace('.', ',')} %`;
}

// The pricing panel forbids the false zero: a non-zero amount that would
// display as "0,00 $" shows as "< 0,01 $" instead. formatUsd itself is NOT
// changed — its consumers are part of the frozen instrument display.
export function formatUsdExact(n) {
  const s = formatUsd(n);
  return n > 0 && s === '0,00 $' ? '< 0,01 $' : s;
}

// Human label derived from the canonical id — same rule as viz-ui.js
// labelForModel, extended to single-digit Claude 5 families ("Opus 5",
// "Fable 5"). No external data; callers keep the raw id in `title`.
export function modelLabel(id) {
  if (!id) return '';
  const m = id.match(/^claude-(opus|sonnet|haiku|fable|mythos)-(\d+)(?:-(\d+))?$/);
  if (!m) return id;
  const family = `${m[1][0].toUpperCase()}${m[1].slice(1)}`;
  return m[3] !== undefined ? `${family} ${m[2]}.${m[3]}` : `${family} ${m[2]}`;
}

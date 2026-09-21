// format.ts — display helpers for the observatory pages.
//
// Pure functions only, no DOM at import time, so they can be unit-tested.
// formatTokens and modelLabel are NOT redefined here: viz-state.ts already owns
// them and is importable under Node.

import { formatTokens, modelLabel } from '../viz-state.ts';
export { formatTokens, modelLabel };

// Le detail d'evidence d'une recommandation — six bornes basses chiffrees
// (une par regle R1/R5/R6/R7 en jetons, R3/R4 en octets), jamais toutes
// presentes a la fois : chaque regle ne remplit que les siennes.
export interface RecommendationEvidence {
  sessions: unknown[];
  costComplete?: boolean;
  prefixChangeTokens?: number;
  reprocessedTokens?: number;
  subagentTokens?: number;
  tokensAfterLastVerification?: number;
  bytes?: number;
  duplicateBytes?: number;
}

// Une recommandation telle que le classement serveur la rend — jamais
// importee de src/server/ (frontiere navigateur/Node).
// status/statusAt/statusReason facultatifs : decisions-view.ts n'en lit qu'un sous-ensemble.
export interface Recommendation {
  id: number;
  title: string;
  confidence: string;
  action: string | null;
  ruleId: string;
  evidence: RecommendationEvidence;
  estimatedCostUsd: number;
  costBasis: string;
  costAtStatusUsd?: number | null;
  status?: string;
  statusAt?: string | null;
  statusReason?: string | null;
  periodFrom?: string | null;
  periodTo?: string | null;
}

// Fenetre 7/30/90 jours d'un resume — memes champs que WindowOpts (api.ts)
// une fois resolus par le serveur.
export interface Period {
  days: number;
  from: string;
  to: string;
}

export interface SummaryBasis {
  includeMachine: boolean;
  counts: { headless: number; unknown: number; interactive: number };
}

// Le resume /analysis/summary — partage par les trois pages (Conseils,
// Sessions analysees, Jetons & tarifs) via `basisLabel`/`periodHeader`.
export interface Summary {
  period?: Period | null;
  basis?: SummaryBasis | null;
  sessions: number;
  costUsd: number;
  netTokens: number;
  cacheReadTokens: number;
  priceSource: string;
  costComplete?: boolean;
}

// Le message de progression SSE (`analysisScan`) — mêmes cinq champs que
// ScanEventMessage (store.ts, non exportée) ; son seul producteur
// (store.ts, applyScanEvent) les écrit tous à chaque fois.
export interface ScanProgress {
  phase: string;
  total: number;
  scanned: number;
  skipped: number;
  failed: number;
}

export function formatUsd(n: number) {
  return `${n.toFixed(2).replace('.', ',')} $`;
}

export function formatBytes(n: number) {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1).replace('.', ',')} Mo`;
  if (n >= 1024) return `${Math.round(n / 1024)} Ko`;
  return `${n} o`;
}

// "—" rather than "0 min": a session without timestamps has an unknown
// duration, not a null one.
export function formatDuration(startedAt: string | null | undefined, endedAt: string | null | undefined) {
  if (!startedAt || !endedAt) return '—';
  const ms = Date.parse(endedAt) - Date.parse(startedAt);
  if (Number.isNaN(ms) || ms < 0) return '—';
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`;
}

const CONFIDENCE_LABELS: Record<string, string> = { fait: 'Fait mesuré', correlation: 'Corrélation', hypothese: 'Hypothèse' };
export function confidenceLabel(c: string) {
  return CONFIDENCE_LABELS[c] || 'Inconnu';
}

const BASIS_LABELS: Record<string, string> = {
  'jetons-mesures': 'jetons mesurés',
  'octets-approx-4o-par-jeton': 'estimé depuis les octets (≈ 4 octets par jeton)',
};
export function costBasisLabel(basis: string) {
  return BASIS_LABELS[basis] || basis;
}

// When a card's dollars are partial (an unknown model in its sessions), the
// measured quantity leads and the dollars demote to a lower bound. One entry
// per rule, reusing the evidence keys the rules already persist; a rule
// without a quantity (R2) keeps the plain partial wording. Ranking is NOT
// affected: ordering tokens against dollars would break the homogeneity rule,
// so ranking.ts keeps scoring the (lower-bound) dollars.
const LEAD_QUANTITY_BY_RULE: Record<string, ((e: RecommendationEvidence) => string) | undefined> = {
  R1: e => `${formatTokens(e.prefixChangeTokens)} jetons mesurés`,
  R5: e => `${formatTokens(e.reprocessedTokens)} jetons mesurés`,
  R6: e => `${formatTokens(e.subagentTokens)} jetons mesurés`,
  R7: e => `${formatTokens(e.tokensAfterLastVerification)} jetons mesurés`,
  // `?? 0` : type-level seulement — R3/R4 posent toujours ce chiffre quand
  // leur formateur tourne, `bytes`/`duplicateBytes` ne sont facultatifs que
  // parce que les cinq autres regles ne les remplissent jamais.
  R3: e => `${formatBytes(e.bytes ?? 0)} mesurés`,
  R4: e => `${formatBytes(e.duplicateBytes ?? 0)} mesurés`,
};

// La preuve et le résumé ne portent que le booléen `costComplete`, pas sa raison (modèle
// sans tarif ou message au `usage` inexploitable) : la phrase doit rester vraie pour les deux.
const PARTIAL_COST_REASON = 'une part des messages n’a pas pu être tarifée';

export function costLabel(rec: Recommendation) {
  if (rec.evidence.costComplete === false) {
    const lead = LEAD_QUANTITY_BY_RULE[rec.ruleId];
    if (lead) {
      return `${lead(rec.evidence)} — dollars incomplets (au moins ${formatUsd(rec.estimatedCostUsd)}`
        + ` : ${PARTIAL_COST_REASON})`;
    }
    return `${formatUsd(rec.estimatedCostUsd)} — ${costBasisLabel(rec.costBasis)}`
      + ` (coût partiel : ${PARTIAL_COST_REASON})`;
  }
  return `${formatUsd(rec.estimatedCostUsd)} — ${costBasisLabel(rec.costBasis)}`;
}

// Heading of a cost-basis block. It exists to tell the reader that the two
// blocks are not comparable — the whole point of ranking them separately.
const BASIS_TITLES: Record<string, string> = {
  'jetons-mesures': 'Chiffré en jetons mesurés',
  'octets-approx-4o-par-jeton': 'Estimé depuis les octets — à ne pas comparer au bloc ci-dessus',
};
export function basisTitle(basis: string) {
  return BASIS_TITLES[basis] || basis;
}

/** JJ/MM local time — the observatory is a single-user local tool. */
export function formatDayMonth(iso: string) {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** JJ/MM/AAAA local time — an arbitration can be old, the year matters. */
function formatDayMonthYear(iso: string) {
  return `${formatDayMonth(iso)}/${new Date(iso).getFullYear()}`;
}

// The decision journal: the user's intention in their own words,
// never the machine statuses. Dates and reasons are enforced at write time;
// a hole says so, never guesses.
const DECISION_VERBS: Record<string, string> = { accepted: 'Adopté', ignored: 'Mis en veille', arbitrated: 'Refusé' };
const DECISION_WATCH: Record<string, string> = {
  accepted: 'reviendra si le coût regrossit malgré tout',
  ignored: 'reviendra si le coût regrossit de moitié',
};

// Le seul appelant reel passe un DecidedRecommendation {id, title}
// (decisions-view.ts) — repris a l'identique, plus les trois champs que
// decisionLine lit, facultatifs comme dans la vue locale de cet appelant.
interface DecisionFields {
  id: number;
  title: string;
  status?: string;
  statusAt?: string | null;
  statusReason?: string | null;
}

function decidedWhen(rec: DecisionFields) {
  const verb = DECISION_VERBS[rec.status ?? ''] ?? rec.status;
  return rec.statusAt ? `${verb} le ${formatDayMonthYear(rec.statusAt)}` : `${verb} (date non consignée)`;
}

// One line per journal card: what was decided, when, and either the user's
// reason (a refusal) or the watch that stays armed (adoption, sleep).
export function decisionLine(rec: DecisionFields) {
  const tail = rec.statusReason ?? DECISION_WATCH[rec.status ?? ''] ?? null;
  return tail ? `${decidedWhen(rec)} — ${tail}` : decidedWhen(rec);
}

// Banner of a decided card that crossed its return threshold and surfaced
// again. The percentage needs a usable baseline; a zero at decision time
// makes it undefined, so the banner states the return without inventing one.
export function returnBanner(rec: Recommendation) {
  if (rec.status !== 'accepted' && rec.status !== 'ignored') return '';
  const base = rec.costAtStatusUsd;
  const growth = typeof base === 'number' && base > 0
    ? ` de ${Math.round((rec.estimatedCostUsd / base - 1) * 100)} %` : '';
  return rec.status === 'accepted'
    ? `${decidedWhen(rec)} — le coût a pourtant regrossi${growth} depuis. Le geste a-t-il pris ?`
    : `${decidedWhen(rec)} — le coût a regrossi${growth} depuis.`;
}

/** Every card states its window; a card without one says so, never guesses. */
export function periodLabel(rec: Recommendation) {
  if (!rec.periodFrom || !rec.periodTo) return 'période du constat non enregistrée (re-scanner)';
  return `constaté du ${formatDayMonth(rec.periodFrom)} au ${formatDayMonth(rec.periodTo)}`;
}

// Shared by both observatory pages (Conseils, Sessions analysées): one
// wording for the announced basis, not one per view.
export function basisLabel(basis: SummaryBasis | null | undefined) {
  if (!basis) return '';
  const { counts, includeMachine } = basis;
  const machines = includeMachine
    ? `${counts.headless} machines incluses · ${counts.unknown} indéterminées incluses`
    : `${counts.headless} machines exclues · ${counts.unknown} indéterminées exclues`;
  return `${counts.interactive} sessions humaines · ${machines}`;
}

export function periodHeader(period: Period | null | undefined) {
  if (!period) return '';
  return `Fenêtre : ${period.days} j — du ${formatDayMonth(period.from)} au ${formatDayMonth(period.to)}`;
}

// Le resume du tiroir Conseils, en deux niveaux : une phrase de tete que tout
// le monde comprend, puis le detail etiquete. Pure mise en forme des chiffres du
// resume, aucun calcul.
export function summaryHeadline(summary: Summary | null | undefined) {
  if (!summary || !summary.period) return '';
  return `Sur ${summary.period.days} jours : ${summary.sessions} sessions, `
    + `${formatUsd(summary.costUsd)} de coût équivalent API`;
}

export function summaryDetails(summary: Summary | null | undefined) {
  if (!summary) return '';
  const partiel = summary.costComplete === false ? ` · coût partiel (${PARTIAL_COST_REASON})` : '';
  return `${formatTokens(summary.netTokens)} jetons nets · `
    + `${formatTokens(summary.cacheReadTokens)} relus depuis le cache · `
    + `prix : ${summary.priceSource}${partiel}`;
}

// Live wording for a running scan (SSE events): the answer to "nothing is
// moving" during the seconds between a purge/rescan click and its 'done'.
export function scanProgressLabel(scan: ScanProgress | null | undefined) {
  if (!scan || scan.phase === 'done') return '';
  const handled = (scan.scanned ?? 0) + (scan.skipped ?? 0) + (scan.failed ?? 0);
  return `Analyse en cours — ${handled}/${scan.total ?? 0} sessions`;
}

// ─── « Jetons & tarifs » panel formatters ─────────────────────────────────

// USD per token → per-MTok wording, the unit rate cards are published in.
export function formatUsdPerMTok(perToken: number) {
  return `${(perToken * 1e6).toFixed(2).replace('.', ',')} $ le million`;
}

export function formatShare(ratio: number) {
  return `${(ratio * 100).toFixed(1).replace('.', ',')} %`;
}

// The pricing panel forbids the false zero: a non-zero amount that would
// display as "0,00 $" shows as "< 0,01 $" instead. formatUsd itself is NOT
// changed — its consumers are part of the frozen instrument display.
export function formatUsdExact(n: number) {
  const s = formatUsd(n);
  return n > 0 && s === '0,00 $' ? '< 0,01 $' : s;
}

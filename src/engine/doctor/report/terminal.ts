import { emptyChurnCauses, emptyPauseBuckets, emptyPrefixBreakdown } from '../aggregators/context.js';
import type {
  BreakDepth,
  CacheWrites,
  ChurnCause,
  ChurnCauseStat,
  PauseBucketKey,
  PauseBuckets,
  PauseTtl,
  PrefixBreakdown,
  PrefixMarker,
} from '../aggregators/context.js';
import { emptyReadCases } from '../aggregators/reads.js';
import type { ReadCase, ReadStats } from '../aggregators/reads.js';
import type { DoctorReport } from './types.js';

function fmtInt(n: number): string {
  return n.toLocaleString('fr-FR');
}

function fmtKo(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  return `${(bytes / 1024).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Ko`;
}

function fmtUsd(usd: number): string {
  return `${usd.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;
}

/** Ordre d'affichage fixe : l'actionnable d'abord, la fausse alerte et l'inconnu en queue. */
const CHURN_CAUSE_LABELS: [ChurnCause, string][] = [
  ['expiration', 'pause > durée de vie du cache'],
  ['compaction', 'compactage'],
  ['prefixChange', 'début de contexte modifié'],
  ['growth', 'fausse alerte (simple croissance)'],
  ['unknown', 'indéterminé'],
];

/** Ligne « causes : … » sous CONTEXTE — cases non vides seulement, null si tout est à zéro. */
export function renderChurnCauses(causes: Record<ChurnCause, ChurnCauseStat>): string | null {
  const parts = CHURN_CAUSE_LABELS.filter(([key]) => causes[key].events > 0).map(
    ([key, label]) => `${label} ×${fmtInt(causes[key].events)} (${fmtInt(causes[key].tokens)} tk)`,
  );
  return parts.length > 0 ? `causes : ${parts.join(' · ')}` : null;
}

const PREFIX_MARKER_LABELS: [PrefixMarker, string][] = [
  ['modelSwitch', 'modèle changé'],
  ['systemChanged', 'bloc système modifié'],
  ['toolsChanged', 'bloc d’outils modifié'],
  ['messagesChanged', 'historique modifié'],
  ['toolsAppeared', 'outils apparus'],
  ['noMarker', 'sans marqueur'],
];

const BREAK_DEPTH_LABELS: [BreakDepth, string][] = [
  ['facade', 'façade (≤ 10 % relu)'],
  ['d10to50', '10–50 % relu'],
  ['d50to90', '50–90 % relu'],
  ['tail', 'queue (> 90 % relu)'],
];

/** Sous-ligne « préfixe modifié » : marqueurs (l'attribution) puis profondeur (la localisation). */
export function renderPrefixBreakdown(b: PrefixBreakdown): string | null {
  const markers = PREFIX_MARKER_LABELS.filter(([k]) => b.markers[k].events > 0).map(
    ([k, label]) => `${label} ×${fmtInt(b.markers[k].events)} (${fmtInt(b.markers[k].tokens)} tk)`,
  );
  if (markers.length === 0) return null;
  const depth = BREAK_DEPTH_LABELS.filter(([k]) => b.depth[k].events > 0).map(
    ([k, label]) => `${label} ×${fmtInt(b.depth[k].events)} (${fmtInt(b.depth[k].tokens)} tk)`,
  );
  return `préfixe modifié — marqueurs : ${markers.join(' · ')} ; profondeur : ${depth.join(' · ')}`;
}

/**
 * Conseils « préfixe modifié » — les 3 gestes utilisateur dont le mécanisme a été prouvé
 * en laboratoire (verdict v0.8.0), jamais déduits de ces journaux (étiquette explicite).
 * Affichés seulement quand prefixChange domine (≥) les causes réelles de re-création :
 * growth (fausse alerte) et unknown (indéterminé) sont exclus de la comparaison.
 */
export function renderPrefixAdvice(
  causes: Record<ChurnCause, ChurnCauseStat>,
  b: PrefixBreakdown,
): string[] | null {
  const p = causes.prefixChange;
  if (p.tokens === 0) return null;
  if (p.tokens < causes.expiration.tokens || p.tokens < causes.compaction.tokens) return null;
  const ms = b.markers.modelSwitch;
  const seen = ms.events > 0 ? ` — vu ici ×${fmtInt(ms.events)} (${fmtInt(ms.tokens)} tk)` : '';
  return [
    'conseil (mécanismes prouvés en labo v0.8.0, pas déduits de ces journaux) :',
    `  · ne pas changer de modèle en cours de session — re-création totale, espaces de cache disjoints${seen}`,
    '  · se méfier des bascules de modèle silencieuses (alias + mode plan) — préférer l’identifiant complet du modèle',
    '  · limiter les reprises rapides après une modification d’environnement (git, CLAUDE.md, réglages, mise à jour) — l’enveloppe est rebâtie à la reprise',
  ];
}

const PAUSE_BUCKET_LABELS: [PauseBucketKey, string][] = [
  ['b5to15m', '5–15 min'],
  ['b15to60m', '15–60 min'],
  ['b1to3h', '1–3 h'],
  ['bOver3h', '> 3 h'],
];

/** Ligne « pauses » : tranches non vides, groupées par durée de vie en vigueur ; null si tout est à zéro. */
export function renderPauseBuckets(buckets: PauseBuckets): string | null {
  const seg = (ttl: PauseTtl, label: string): string | null => {
    const parts = PAUSE_BUCKET_LABELS.filter(([k]) => buckets[ttl][k].events > 0).map(
      ([k, l]) => `${l} ×${fmtInt(buckets[ttl][k].events)} (${fmtInt(buckets[ttl][k].tokens)} tk)`,
    );
    return parts.length > 0 ? `${label} : ${parts.join(' · ')}` : null;
  };
  const segs = [seg('ttl5m', 'durée de vie 5 min'), seg('ttl1h', 'durée de vie 1 h')].filter((s): s is string => s !== null);
  return segs.length > 0 ? `pauses — ${segs.join(' — ')}` : null;
}

/** Ligne « écritures cache » : part du 1 h par mois (la migration de l'hôte) ; le sans-détail affiché à part. */
export function renderCacheWritesByMonth(sessions: { startedAt: string | null; cacheWrites: CacheWrites }[]): string | null {
  const byMonth = new Map<string, { t5: number; t1: number }>();
  let unknown = 0;
  let total = 0;
  for (const s of sessions) {
    const w = s.cacheWrites;
    total += w.tokens5m + w.tokens1h + w.tokensUnknown;
    unknown += w.tokensUnknown;
    if (w.tokens5m + w.tokens1h === 0) continue;
    const month = s.startedAt !== null ? s.startedAt.slice(0, 7) : '(sans date)';
    const acc = byMonth.get(month) ?? { t5: 0, t1: 0 };
    acc.t5 += w.tokens5m;
    acc.t1 += w.tokens1h;
    byMonth.set(month, acc);
  }
  if (total === 0) return null;
  const months = [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([m, { t5, t1 }]) => `${m} → 1 h ${Math.round((100 * t1) / (t5 + t1))} %`);
  const parts = months.length > 0 ? [`écritures cache : ${months.join(' · ')}`] : ['écritures cache'];
  if (unknown > 0) parts.push(`détail absent : ${fmtInt(unknown)} tk`);
  return parts.join(' · ');
}

/** Cases affichées après la première lecture — l'actionnable d'abord (le gisement du dédoublonneur). */
const READ_CASE_LABELS: [ReadCase, string][] = [
  ['identicalReread', 'relectures identiques'],
  ['modifiedReread', 'après modification'],
  ['crossAgentDuplicate', 'doublons inter-agents'],
  ['error', 'erreurs'],
];

/** Ligne « LECTURES » : total Read puis chaque case non vide avec sa part des octets ; null si aucun Read. */
export function renderReadsLine(stats: ReadStats): string | null {
  if (stats.totalResults === 0) return null;
  const pct = (bytes: number): string => `${Math.round((100 * bytes) / stats.totalBytes)} %`;
  const parts = READ_CASE_LABELS.filter(([k]) => stats.cases[k].count > 0).map(
    ([k, label]) => `${label} ×${fmtInt(stats.cases[k].count)} (${fmtKo(stats.cases[k].bytes)} · ${pct(stats.cases[k].bytes)})`,
  );
  const head = `Read ×${fmtInt(stats.totalResults)} (${fmtKo(stats.totalBytes)})`;
  return parts.length > 0 ? `${head} — ${parts.join(' · ')}` : head;
}

/**
 * Contrefactuel « tout en cache 1 h », en tokens équivalents au tarif de base :
 * R (expirations récupérables sous 5 min, pause ≤ 1 h) serait relu à 0,1× au lieu
 * d'être réécrit à 1,25× (gain 1,15×R) ; W (les autres écritures 5 min) passerait
 * à 2× au lieu de 1,25× (coût 0,75×W). Étiqueté, jamais un compteur de gain.
 */
export function renderCounterfactual1h(c: { recoverableTokens: number; tokens5m: number }): string | null {
  if (c.recoverableTokens === 0 && c.tokens5m === 0) return null;
  const w = Math.max(0, c.tokens5m - c.recoverableTokens);
  const gain = Math.round(1.15 * c.recoverableTokens);
  const cost = Math.round(0.75 * w);
  const verdict = gain > cost ? 'rentable' : 'pas rentable';
  return (
    `contrefactuel « tout en cache 1 h » : gain ${fmtInt(gain)} tk vs coût ${fmtInt(cost)} tk ` +
    `(équivalent tarif de base) → ${verdict} — hypothèses : premier ordre, écart réponse-à-réponse`
  );
}

/** Constantes J6 (j6-regret-oracle) : −48 % mesuré sur les tours à signal de graphe, taxe de présence +1,4 à +6 % (n.s.) ailleurs. */
const J6_TRIGGERED_GAIN = 0.48;
const J6_PRESENCE_TAX = { low: 0.014, high: 0.06 };

export interface LivedGainProjection {
  /** Part de la dépense nette partie dans les tours tirés, en % du net. */
  sharePct: number;
  /** Bornes de la fourchette de gain projeté, en % du net (négatif = netgain coûterait). */
  lowPct: number;
  highPct: number;
  /** install : les deux bornes > 0 ; skip : les deux ≤ 0 ; uncertain : à cheval sur zéro. */
  verdict: 'install' | 'skip' | 'uncertain';
}

/**
 * Projection « gain vécu » — jamais un chiffre sec, toujours une fourchette :
 * basse = s×48 % − (1−s)×6 % ; haute = s×48 % − (1−s)×1,4 %. Le −48 % appliqué
 * aux seuls tours tirés est un minorant (en J6 il était mesuré sessions
 * entières) ; la taxe est comptée sur 100 % du reste, non-attribuable inclus.
 */
export function computeLivedGain(triggeredNetTokens: number, totalNetTokens: number): LivedGainProjection | null {
  if (totalNetTokens <= 0) return null;
  const share = triggeredNetTokens / totalNetTokens;
  const lowPct = 100 * (share * J6_TRIGGERED_GAIN - (1 - share) * J6_PRESENCE_TAX.high);
  const highPct = 100 * (share * J6_TRIGGERED_GAIN - (1 - share) * J6_PRESENCE_TAX.low);
  const verdict = lowPct > 0 ? 'install' : highPct <= 0 ? 'skip' : 'uncertain';
  return { sharePct: 100 * share, lowPct, highPct, verdict };
}

/** Pourcent à 1 décimale, signe typographique explicite pour les bornes (« +0,6 % » / « −6,0 % »). */
function fmtPct1(x: number): string {
  return `${Math.abs(x).toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
}

function fmtSignedPct1(x: number): string {
  return `${x < 0 ? '−' : '+'}${fmtPct1(x)}`;
}

const LIVED_GAIN_VERDICT_LABELS: Record<LivedGainProjection['verdict'], string> = {
  install: '→ installer',
  skip: '→ sur ce profil, ne pas installer',
  uncertain: '→ incertain (la fourchette chevauche zéro)',
};

/**
 * Section « gain vécu » d'un dépôt : 3 lignes (faits, fourchette, hypothèses).
 * La projection vit ICI, au rendu — le contrat --json n'expose que les comptes.
 */
export function renderLivedGain(p: {
  turns: number;
  triggeredTurns: number;
  triggeredNetTokens: number;
  totalNetTokens: number;
  unattributedNetTokens: number;
}): string[] | null {
  const proj = computeLivedGain(p.triggeredNetTokens, p.totalNetTokens);
  if (proj === null) return null;
  const questionPct = p.turns > 0 ? (100 * p.triggeredTurns) / p.turns : 0;
  return [
    `gain vécu (projection J6, pas une mesure) : questions qui tirent ${fmtInt(p.triggeredTurns)}/${fmtInt(p.turns)} (${fmtPct1(questionPct)}) · ` +
      `dépense des tours tirés ${fmtInt(p.triggeredNetTokens)} tk (${fmtPct1(proj.sharePct)} du net)`,
    `  projection : entre ${fmtSignedPct1(proj.lowPct)} et ${fmtSignedPct1(proj.highPct)} du net ${LIVED_GAIN_VERDICT_LABELS[proj.verdict]}`,
    `  hypothèses : −48 % (J6) sur les seuls tours tirés (minorant) · taxe de présence 1,4–6 % sur tout le reste · ` +
      `non-attribuable ${fmtInt(p.unattributedNetTokens)} tk compté dans le reste · sous-agent facturé à son tour de lancement`,
  ];
}

/**
 * Section « comportement-agent » d'un dépôt : les gestes de graphe que l'AGENT
 * fait à la main (recherches d'imports), même quand l'humain ne demande rien —
 * l'angle mort du « gain vécu » v0.7.0. La fourchette élargie n'apparaît que si
 * des tours SANS question de graphe portent des gestes, et elle est étiquetée
 * pour ce qu'elle est : le routeur livré tire au prompt, pas au geste — l'étage
 * qui récupérerait ces tours n'existe pas.
 */
export function renderAgentBehavior(p: {
  gestureEvents: number;
  grep: number;
  bash: number;
  spawn: number;
  agentOnlyTurns: number;
  agentOnlyNetTokens: number;
  triggeredNetTokens: number;
  totalNetTokens: number;
}): string[] | null {
  if (p.gestureEvents === 0) return null;
  const kinds = [
    p.grep > 0 ? `motif d’import via Grep ×${fmtInt(p.grep)}` : null,
    p.bash > 0 ? `via Bash ×${fmtInt(p.bash)}` : null,
    p.spawn > 0 ? `sous-agent missionné graphe ×${fmtInt(p.spawn)}` : null,
  ].filter((s): s is string => s !== null);
  const pct = p.totalNetTokens > 0 ? fmtPct1((100 * p.agentOnlyNetTokens) / p.totalNetTokens) : fmtPct1(0);
  const lines = [
    `comportement-agent : recherches d’imports faites à la main ×${fmtInt(p.gestureEvents)} (${kinds.join(' · ')})`,
    `  dont tours SANS question de graphe : ${fmtInt(p.agentOnlyTurns)} tour(s) (${fmtInt(p.agentOnlyNetTokens)} tk · ${pct} du net)`,
  ];
  const proj = p.agentOnlyNetTokens > 0 ? computeLivedGain(p.triggeredNetTokens + p.agentOnlyNetTokens, p.totalNetTokens) : null;
  if (proj !== null) {
    lines.push(
      `  fourchette élargie (hypothèse : un routeur au geste transfère le −48 % J6 — étage NON construit, pas une mesure) : ` +
        `entre ${fmtSignedPct1(proj.lowPct)} et ${fmtSignedPct1(proj.highPct)} du net ${LIVED_GAIN_VERDICT_LABELS[proj.verdict]}`,
    );
  }
  return lines;
}

/**
 * Rendu terminal : des faits, pas de compteur de gain. Les anomalies
 * (lignes illisibles, modèles sans tarif, types inconnus) sont TOUJOURS affichées.
 */
export function renderReport(r: DoctorReport): string {
  const L: string[] = [];
  L.push('netgain doctor — distribution factuelle des tokens (local, lecture seule)');
  L.push(`racine : ${r.claudeDir} · généré : ${r.generatedAt}`);
  L.push('');

  const scanBits = [`${fmtInt(r.scan.sessions)} session(s)`, `${fmtInt(r.scan.events)} événement(s)`];
  if (r.scan.skippedSessions > 0) scanBits.push(`⚠ ${fmtInt(r.scan.skippedSessions)} session(s) sautée(s)`);
  L.push(`SCAN       ${scanBits.join(' · ')}`);
  if (r.scan.parseErrors > 0) L.push(`           ⚠ ${fmtInt(r.scan.parseErrors)} ligne(s) illisible(s)`);
  const others = Object.entries(r.scan.otherEventTypes).sort((a, b) => b[1] - a[1]);
  if (others.length > 0) {
    L.push(`           types non exploités : ${others.map(([t, n]) => `${t} ×${n}`).join(', ')}`);
  }
  L.push('');

  const cost = r.totals.costComplete
    ? fmtUsd(r.totals.costUsd)
    : `${fmtUsd(r.totals.costUsd)} (partiel ⚠ — modèles sans tarif : ${r.scan.unknownModels.join(', ')})`;
  L.push('TOKENS     (net = input + cache_creation + output ; cache_read exclu)');
  L.push(`           net : ${fmtInt(r.totals.netTokens)} tk · coût connu : ${cost}`);
  L.push('');

  const sessions = r.projects.flatMap((p) => p.sessions);
  const bySize = { small: { count: 0, bytes: 0 }, band: { count: 0, bytes: 0 }, large: { count: 0, bytes: 0 } };
  const byRecognizer = new Map<string, { bytes: number; bandBytes: number }>();
  const candidates = new Map<string, { count: number; bytes: number }>();
  let churnEvents = 0;
  let churnTokens = 0;
  const churnCauses = emptyChurnCauses();
  const prefixBreakdown = emptyPrefixBreakdown();
  const pauseBuckets = emptyPauseBuckets();
  const readStats: ReadStats = { totalResults: 0, totalBytes: 0, cases: emptyReadCases() };
  let compactions = 0;
  const promptCategories = new Map<string, number>();
  for (const s of sessions) {
    for (const key of ['small', 'band', 'large'] as const) {
      bySize[key].count += s.toolResults.bySize[key].count;
      bySize[key].bytes += s.toolResults.bySize[key].bytes;
    }
    for (const [id, stat] of Object.entries(s.toolResults.byRecognizer)) {
      const acc = byRecognizer.get(id) ?? { bytes: 0, bandBytes: 0 };
      acc.bytes += stat.bytes;
      acc.bandBytes += stat.bandBytes;
      byRecognizer.set(id, acc);
    }
    for (const c of s.toolResults.candidateFilters) {
      const acc = candidates.get(c.family) ?? { count: 0, bytes: 0 };
      acc.count += c.count;
      acc.bytes += c.bytes;
      candidates.set(c.family, acc);
    }
    churnEvents += s.context.cacheChurnEvents;
    churnTokens += s.context.cacheChurnTokens;
    for (const [cause, stat] of Object.entries(s.context.churnCauses) as [ChurnCause, ChurnCauseStat][]) {
      churnCauses[cause].events += stat.events;
      churnCauses[cause].tokens += stat.tokens;
    }
    for (const [marker, stat] of Object.entries(s.context.prefixBreakdown.markers) as [PrefixMarker, ChurnCauseStat][]) {
      prefixBreakdown.markers[marker].events += stat.events;
      prefixBreakdown.markers[marker].tokens += stat.tokens;
    }
    for (const key of ['earlyMcp', 'other'] as const) {
      prefixBreakdown.noMarkerDetail[key].events += s.context.prefixBreakdown.noMarkerDetail[key].events;
      prefixBreakdown.noMarkerDetail[key].tokens += s.context.prefixBreakdown.noMarkerDetail[key].tokens;
    }
    for (const [depth, stat] of Object.entries(s.context.prefixBreakdown.depth) as [BreakDepth, ChurnCauseStat][]) {
      prefixBreakdown.depth[depth].events += stat.events;
      prefixBreakdown.depth[depth].tokens += stat.tokens;
    }
    readStats.totalResults += s.reads.totalResults;
    readStats.totalBytes += s.reads.totalBytes;
    for (const [readCase, stat] of Object.entries(s.reads.cases) as [ReadCase, { count: number; bytes: number }][]) {
      readStats.cases[readCase].count += stat.count;
      readStats.cases[readCase].bytes += stat.bytes;
    }
    for (const ttl of ['ttl5m', 'ttl1h'] as PauseTtl[]) {
      for (const [bucket, stat] of Object.entries(s.context.pauseBuckets[ttl]) as [PauseBucketKey, ChurnCauseStat][]) {
        pauseBuckets[ttl][bucket].events += stat.events;
        pauseBuckets[ttl][bucket].tokens += stat.tokens;
      }
    }
    compactions += s.context.compactions.length;
    for (const p of s.prompts.corpus) promptCategories.set(p.category, (promptCategories.get(p.category) ?? 0) + 1);
  }

  L.push('TOOL_RESULTS');
  L.push(
    `           <2 Ko : ${fmtInt(bySize.small.count)} (${fmtKo(bySize.small.bytes)}) · ` +
      `2–30 Ko : ${fmtInt(bySize.band.count)} (${fmtKo(bySize.band.bytes)}) · ` +
      `>30 Ko : ${fmtInt(bySize.large.count)} (${fmtKo(bySize.large.bytes)})`,
  );
  const recs = [...byRecognizer.entries()].sort((a, b) => b[1].bytes - a[1].bytes);
  if (recs.length > 0) {
    L.push(`           formats reconnus : ${recs.map(([id, s]) => `${id} ${fmtKo(s.bytes)} (bande ${fmtKo(s.bandBytes)})`).join(' · ')}`);
  }
  const cands = [...candidates.entries()].sort((a, b) => b[1].bytes - a[1].bytes).slice(0, 8);
  if (cands.length > 0) {
    L.push(`           candidats filtres (répétés, non reconnus) : ${cands.map(([f, s]) => `${f} ×${s.count} (${fmtKo(s.bytes)})`).join(' · ')}`);
  }
  const readsLine = renderReadsLine(readStats);
  if (readsLine !== null) L.push(`LECTURES   ${readsLine}`);
  L.push('');

  L.push(`SOUS-AGENTS  ${fmtInt(r.totals.subagentSidecars)} side-car(s)`);
  L.push(
    `CONTEXTE     re-création de cache (churn) : ${fmtInt(churnEvents)} événement(s) (${fmtInt(churnTokens)} tk) · compactions : ${fmtInt(compactions)}`,
  );
  const causesLine = renderChurnCauses(churnCauses);
  if (causesLine !== null) L.push(`             ${causesLine}`);
  const prefixLine = renderPrefixBreakdown(prefixBreakdown);
  if (prefixLine !== null) L.push(`             ${prefixLine}`);
  const adviceLines = renderPrefixAdvice(churnCauses, prefixBreakdown);
  if (adviceLines !== null) for (const line of adviceLines) L.push(`             ${line}`);
  const pauseLine = renderPauseBuckets(pauseBuckets);
  if (pauseLine !== null) L.push(`             ${pauseLine}`);
  const writesLine = renderCacheWritesByMonth(sessions.map((s) => ({ startedAt: s.startedAt, cacheWrites: s.context.cacheWrites })));
  if (writesLine !== null) L.push(`             ${writesLine}`);
  const cfLine = renderCounterfactual1h({
    recoverableTokens: pauseBuckets.ttl5m.b5to15m.tokens + pauseBuckets.ttl5m.b15to60m.tokens,
    tokens5m: sessions.reduce((acc, s) => acc + s.context.cacheWrites.tokens5m, 0),
  });
  if (cfLine !== null) L.push(`             ${cfLine}`);
  const mapPct = r.totals.totalPrompts > 0 ? Math.round((100 * r.totals.mapShapedPrompts) / r.totals.totalPrompts) : 0;
  const cats = [...promptCategories.entries()].sort((a, b) => b[1] - a[1]);
  L.push(
    `PROMPTS      ${fmtInt(r.totals.totalPrompts)} humain(s) · forme carte : ${fmtInt(r.totals.mapShapedPrompts)} (${mapPct} %)` +
      (cats.length > 0 ? ` — ${cats.map(([c, n]) => `${c} ×${n}`).join(', ')}` : ''),
  );
  L.push('');

  L.push('PAR PROJET');
  const projects = [...r.projects].sort((a, b) => b.totals.netTokens - a.totals.netTokens);
  for (const p of projects) {
    const projCost = p.totals.costComplete ? fmtUsd(p.totals.costUsd) : `${fmtUsd(p.totals.costUsd)} ⚠ partiel`;
    L.push(`  ${p.projectSlug} : ${fmtInt(p.totals.sessions)} session(s) · net ${fmtInt(p.totals.netTokens)} tk · coût connu ${projCost}`);
    for (const f of p.claudeMdFiles) {
      L.push(`    CLAUDE.md (état disque actuel, approximation) : ${f.path} — ${fmtKo(f.bytes)}`);
    }
    const gainLines = renderLivedGain({
      turns: p.totals.turns,
      triggeredTurns: p.totals.triggeredTurns,
      triggeredNetTokens: p.totals.triggeredNetTokens,
      totalNetTokens: p.totals.netTokens,
      unattributedNetTokens: p.totals.turnsUnattributedNetTokens,
    });
    if (gainLines !== null) for (const line of gainLines) L.push(`    ${line}`);
    const behaviorLines = renderAgentBehavior({
      gestureEvents: p.totals.agentGestureEvents,
      grep: p.totals.agentGrepGestures,
      bash: p.totals.agentBashGestures,
      spawn: p.totals.agentSpawnGestures,
      agentOnlyTurns: p.totals.agentOnlyTurns,
      agentOnlyNetTokens: p.totals.agentOnlyNetTokens,
      triggeredNetTokens: p.totals.triggeredNetTokens,
      totalNetTokens: p.totals.netTokens,
    });
    if (behaviorLines !== null) for (const line of behaviorLines) L.push(`    ${line}`);
  }
  L.push('');
  return L.join('\n');
}

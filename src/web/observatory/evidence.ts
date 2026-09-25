// evidence.ts — turns each rule's measured numbers into French sentences.
//
// One entry per rule, in a table: a rule missing from here would display a
// recommendation with no figures, which the founding rule forbids. Kept apart
// from format.ts because it changes for a different reason — a new rule, not a
// new display convention.

import { formatTokens, formatBytes } from './format.ts';

// R1 names the marker the engine journaled and where the prefix broke. The
// rule decides which one dominates; this file only puts it into French.
// "Marqueur", never "cause": only modelSwitch has a proven mechanism (caches are model-scoped).
// toolsAppeared is a coincidence: deferred tool loading appends to the history and preserves the
// cache (official docs; our controlled test agrees, docs/sources-externes.md).
// The three *Changed markers come from message.diagnostics.cache_miss_reason
// (Claude Code ≥ ~2.1.220): the client compared the request to the previous one
// and named the block that changed. First-hand facts — the wording may assert
// WHAT changed, never WHICH setting caused it.
const R1_MARKER_LABEL = {
  modelSwitch: 'changement de modèle — mécanisme certain, un cache par modèle',
  systemChanged: 'bloc système modifié — diagnostiqué par Claude Code (réglage, mode ou version changés en cours de session)',
  toolsChanged: 'bloc d’outils modifié — diagnostiqué par Claude Code (serveur MCP ou outil basculé en cours de session)',
  messagesChanged: 'historique modifié — diagnostiqué par Claude Code (contenu déjà servi ré-écrit)',
  toolsAppeared: 'chargement d’outils différés — coïncidence observée, sans mécanisme établi',
  noMarker: 'aucun marqueur journalisé',
};
const R1_DEPTH_LABEL = {
  facade: 'en façade du contexte (bloc système et outils)',
  d10to50: 'entre 10 et 50 % de profondeur',
  d50to90: 'entre 50 et 90 % de profondeur',
  tail: 'en fin de contexte',
};

// Short cell names for the diagnosed-attribution detail line — the long
// R1_MARKER_LABEL wordings would drown a three-cell enumeration.
const R1_DIAGNOSED_SHORT = {
  toolsChanged: 'bloc d’outils',
  messagesChanged: 'historique',
  systemChanged: 'bloc système',
};

/** Ligne facultative : sous un dominant « sans marqueur » (poids des vieux
 * journaux), les attributions de première main de la fenêtre restent dites. */
function diagnosedDetailLine(markerTokens: Record<string, number>) {
  const cells = Object.entries(R1_DIAGNOSED_SHORT)
    .map(([key, label]): [string, number] => [label, markerTokens[key] ?? 0])
    .filter(([, tokens]) => tokens > 0)
    .sort((a, b) => b[1] - a[1]);
  if (cells.length === 0) return [];
  const total = cells.reduce((acc, [, tokens]) => acc + tokens, 0);
  return [`dont attribués par le diagnostic de Claude Code : ${formatTokens(total)} jetons `
    + `(${cells.map(([label, tokens]) => `${label} ${formatTokens(tokens)}`).join(' · ')})`];
}

interface R1Evidence {
  prefixChangeTokens: number;
  dominantMarker: keyof typeof R1_MARKER_LABEL;
  markerTokens: Record<string, number>;
  dominantDepth: keyof typeof R1_DEPTH_LABEL;
  depthTokens: Record<string, number>;
  shareOfNetPercent: number;
  noMarkerDetailTokens?: { earlyMcp: number };
}
interface R2Evidence { loadedSessions: number; usedSessions: number }
interface R3Evidence { count: number; bytes: number; shareOfToolBytesPercent: number }
interface R4Evidence { duplicateBytes: number; duplicateCount: number; shareOfReadBytesPercent: number }
interface R5Evidence { compactions: number; reprocessedTokens: number; compactionsWithoutTokenCount: number }
interface R6Evidence { spawns: number; medianDurationSeconds: number; subagentTokens: number }
interface R7Evidence {
  sessionsNoVerification: number;
  sessionsWithTail: number;
  filesUnverifiedBySession: number;
  tokensAfterLastVerification: number;
  excludedPendingRescan: number;
}
interface R8Evidence { hidden: { name: string; sessions: number }[]; sessionsAnalysed: number; largestListingChars: number; excludedPendingRescan: number }
interface R9Evidence { copies: { name: string; chars: number }[]; excludedPendingRescan: number }
interface R10Evidence { typedCount: number; entryChars: number; excludedPendingRescan: number }
interface R11Evidence { invocations: number; maxLines: number; bytes: number; excludedPendingRescan: number }

const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;

// Une session stockée avant la ré-analyse est dite, jamais fondue dans un zéro (précédent R5).
function pendingRescanLine(n: number): string[] {
  return n > 0 ? [`${plural(n, 'session')} en attente de ré-analyse (non prise${n > 1 ? 's' : ''} en compte ici)`] : [];
}

// Chaque règle a sa propre forme de preuve (interfaces ci-dessus), associée
// ici à son formateur par un identifiant dynamique (`rec.ruleId`) : aucun
// paramètre commun n'est sain sans la redécrire. `any` reste local à cette table.
const EVIDENCE_BY_RULE: Record<string, ((e: any) => string[]) | undefined> = {
  R1: (e: R1Evidence) => [
    `${formatTokens(e.prefixChangeTokens)} jetons de préfixe reconstruit`,
    `marqueur dominant : ${R1_MARKER_LABEL[e.dominantMarker]} (${formatTokens(e.markerTokens[e.dominantMarker])} jetons)`,
    ...(e.dominantMarker === 'noMarker' ? diagnosedDetailLine(e.markerTokens) : []),
    `cassure ${R1_DEPTH_LABEL[e.dominantDepth]} (${formatTokens(e.depthTokens[e.dominantDepth])} jetons)`,
    `${Math.round(e.shareOfNetPercent)} % des jetons nets de ces sessions`,
    // `noMarkerDetailTokens` is absent from evidence stored before the engine split it out:
    // an optional detail, shown only once it carries a real figure, never as a false zero.
    ...(e.noMarkerDetailTokens && e.noMarkerDetailTokens.earlyMcp > 0 ? [
      `dont cassures en début de session à serveurs MCP : ${formatTokens(e.noMarkerDetailTokens.earlyMcp)} jetons`
      + ' — cause probable (étude : corrélation ×6,3 sur 1 700 sessions)',
    ] : []),
  ],
  R2: (e: R2Evidence) => [
    `chargé dans ${e.loadedSessions} sessions, appelé dans ${e.usedSessions}`,
    'configuration actuelle appliquée à la période (photo, pas historique)',
  ],
  R3: (e: R3Evidence) => [
    `${e.count} occurrences`,
    `${formatBytes(e.bytes)} de sortie`,
    `${Math.round(e.shareOfToolBytesPercent)} % des sorties d’outils de la période`,
  ],
  R4: (e: R4Evidence) => [
    `${formatBytes(e.duplicateBytes)} relus par un autre agent`,
    `${e.duplicateCount} relectures`,
    `${Math.round(e.shareOfReadBytesPercent)} % du volume lu`,
  ],
  R5: (e: R5Evidence) => {
    const lines = [`${e.compactions} compactions`, `${formatTokens(e.reprocessedTokens)} jetons re-traités`];
    // A compaction whose volume is unknown is said so, never folded in as zero.
    if (e.compactionsWithoutTokenCount > 0) {
      const n = e.compactionsWithoutTokenCount;
      lines.push(`${n} compaction${n > 1 ? 's' : ''} dont le volume est inconnu (non compté${n > 1 ? 'es' : 'e'})`);
    }
    return lines;
  },
  R6: (e: R6Evidence) => [
    `${e.spawns} sous-agents lancés`,
    `sessions de ${e.medianDurationSeconds} s (médiane)`,
    `${formatTokens(e.subagentTokens)} jetons de sous-agents`,
  ],
  // R7 : des faits « dans la session » — une vérification lancée hors
  // session (CI, terminal humain) est invisible, la formulation le dit.
  R7: (e: R7Evidence) => {
    const lines = [
      `${e.sessionsNoVerification} session${e.sessionsNoVerification > 1 ? 's' : ''} modifiant des fichiers sans aucune vérification lancée`,
      // Pas « close » : la règle ne teste jamais la fin de session — une session
      // encore vivante peut être là.
      `${e.sessionsWithTail} session${e.sessionsWithTail > 1 ? 's' : ''} avec des modifications postérieures à la dernière vérification`,
      `${e.filesUnverifiedBySession} fichier${e.filesUnverifiedBySession > 1 ? 's' : ''} laissé${e.filesUnverifiedBySession > 1 ? 's' : ''} sans preuve dans la session (cumul par session)`,
      // Pas « après la dernière vérification » : une session sans aucune vérification,
      // le cas MAJORITAIRE, n'a pas de « dernière » et le compteur y vaut TOUTE la
      // session. La phrase dit ce qui est mesuré, et nomme ce cas au lieu de le taire.
      `${formatTokens(e.tokensAfterLastVerification)} jetons émis sans preuve dans la session`
      + " (toute la session quand aucune vérification n'a été lancée)"
      + ' — travail à risque, pas gaspillage prouvé',
    ];
    return [...lines, ...pendingRescanLine(e.excludedPendingRescan)];
  },
  R8: (e: R8Evidence) => [
    `sans description : ${e.hidden.map(h => `${h.name} (${plural(h.sessions, 'session')})`).join(', ')}`,
    `sur ${plural(e.sessionsAnalysed, 'session')} analysée${e.sessionsAnalysed > 1 ? 's' : ''}`,
    `plus grande liste : ${e.largestListingChars} caractères d’entrées`,
    ...pendingRescanLine(e.excludedPendingRescan),
  ],
  R9: (e: R9Evidence) => [
    `copies : ${e.copies.map(c => `${c.name} (${c.chars} caractères)`).join(', ')}`,
    ...pendingRescanLine(e.excludedPendingRescan),
  ],
  R10: (e: R10Evidence) => [
    `tapé ${e.typedCount} fois, jamais appelé par Claude`,
    `${e.entryChars} caractères d’entrée dans la liste, envoyés à chaque tour`,
    ...pendingRescanLine(e.excludedPendingRescan),
  ],
  R11: (e: R11Evidence) => [
    plural(e.invocations, 'chargement'),
    `${e.maxLines} lignes pour le plus long`,
    `${formatBytes(e.bytes)} chargés au total`,
    ...pendingRescanLine(e.excludedPendingRescan),
  ],
};

export function evidenceLines(rec: { ruleId: string; evidence: { sessions: unknown[] } }): string[] {
  const count = rec.evidence.sessions.length;
  const head = `${count} session${count > 1 ? 's' : ''} concernée${count > 1 ? 's' : ''}`;
  const detail = EVIDENCE_BY_RULE[rec.ruleId];
  return detail ? [head, ...detail(rec.evidence)] : [head];
}

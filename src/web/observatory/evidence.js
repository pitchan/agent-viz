// evidence.js — turns each rule's measured numbers into French sentences.
//
// One entry per rule, in a table: a rule missing from here would display a
// recommendation with no figures, which the founding rule forbids. Kept apart
// from format.js because it changes for a different reason — a new rule, not a
// new display convention.

import { formatTokens, formatBytes } from './format.js';

// R1 names the marker the engine journaled and where the prefix broke. The
// rule decides which one dominates; this file only puts it into French.
// "Marqueur", never "cause" (corrected 2026-08-05): of the three, only
// modelSwitch has a proven mechanism (caches are model-scoped). toolsAppeared
// is a temporal coincidence — the official docs state that deferred tool
// loading appends to the history and preserves the cache, and our controlled
// test agreed (+265 tk, full re-read). Asserting it as a cause was false
// information served to the user.
const R1_MARKER_LABEL = {
  modelSwitch: 'changement de modèle — mécanisme certain, un cache par modèle',
  toolsAppeared: 'chargement d’outils différés — coïncidence observée, sans mécanisme établi',
  noMarker: 'aucun marqueur journalisé',
};
const R1_DEPTH_LABEL = {
  facade: 'en façade du contexte (bloc système et outils)',
  d10to50: 'entre 10 et 50 % de profondeur',
  d50to90: 'entre 50 et 90 % de profondeur',
  tail: 'en fin de contexte',
};

const EVIDENCE_BY_RULE = {
  R1: e => [
    `${formatTokens(e.prefixChangeTokens)} jetons de préfixe reconstruit`,
    `marqueur dominant : ${R1_MARKER_LABEL[e.dominantMarker]} (${formatTokens(e.markerTokens[e.dominantMarker])} jetons)`,
    `cassure ${R1_DEPTH_LABEL[e.dominantDepth]} (${formatTokens(e.depthTokens[e.dominantDepth])} jetons)`,
    `${Math.round(e.shareOfNetPercent)} % des jetons nets de ces sessions`,
    // Absent from M1-era evidence: an optional detail, not a required field —
    // shown only once it carries a real figure, never as a false zero.
    ...(e.noMarkerDetailTokens && e.noMarkerDetailTokens.earlyMcp > 0 ? [
      `dont cassures en début de session à serveurs MCP : ${formatTokens(e.noMarkerDetailTokens.earlyMcp)} jetons`
      + ' — cause probable (étude : corrélation ×6,3 sur 1 700 sessions)',
    ] : []),
  ],
  R2: e => [
    `chargé dans ${e.loadedSessions} sessions, appelé dans ${e.usedSessions}`,
    'configuration actuelle appliquée à la période (photo, pas historique)',
  ],
  R3: e => [
    `${e.count} occurrences`,
    `${formatBytes(e.bytes)} de sortie`,
    `${Math.round(e.shareOfToolBytesPercent)} % des sorties d’outils de la période`,
  ],
  R4: e => [
    `${formatBytes(e.duplicateBytes)} relus par un autre agent`,
    `${e.duplicateCount} relectures`,
    `${Math.round(e.shareOfReadBytesPercent)} % du volume lu`,
  ],
  R5: e => {
    const lines = [`${e.compactions} compactions`, `${formatTokens(e.reprocessedTokens)} jetons re-traités`];
    // A compaction whose volume is unknown is said so, never folded in as zero.
    if (e.compactionsWithoutTokenCount > 0) {
      const n = e.compactionsWithoutTokenCount;
      lines.push(`${n} compaction${n > 1 ? 's' : ''} dont le volume est inconnu (non compté${n > 1 ? 'es' : 'e'})`);
    }
    return lines;
  },
  R6: e => [
    `${e.spawns} sous-agents lancés`,
    `sessions de ${e.medianDurationSeconds} s (médiane)`,
    `${formatTokens(e.subagentTokens)} jetons de sous-agents`,
  ],
  // R7 (doc/41) : des faits « dans la session » — une vérification lancée hors
  // session (CI, terminal humain) est invisible, la formulation le dit.
  R7: e => {
    const lines = [
      `${e.sessionsNoVerification} session${e.sessionsNoVerification > 1 ? 's' : ''} modifiant des fichiers sans aucune vérification lancée`,
      // « close » est tombé (revue doc/41) : la règle ne teste jamais la fin de
      // session — une session encore vivante peut être là. Le fait dit reste vrai.
      `${e.sessionsWithTail} session${e.sessionsWithTail > 1 ? 's' : ''} avec des modifications postérieures à la dernière vérification`,
      `${e.filesUnverifiedBySession} fichiers laissés sans preuve dans la session (cumul par session)`,
      `${formatTokens(e.tokensAfterLastVerification)} jetons émis après la dernière vérification — travail à risque, pas gaspillage prouvé`,
    ];
    // Une session d'avant la ré-analyse v8 est dite, jamais fondue dans un zéro (précédent R5).
    if (e.excludedPendingRescan > 0) {
      const n = e.excludedPendingRescan;
      lines.push(`${n} session${n > 1 ? 's' : ''} en attente de ré-analyse (non prise${n > 1 ? 's' : ''} en compte ici)`);
    }
    return lines;
  },
};

export function evidenceLines(rec) {
  const count = rec.evidence.sessions.length;
  const head = `${count} session${count > 1 ? 's' : ''} concernée${count > 1 ? 's' : ''}`;
  const detail = EVIDENCE_BY_RULE[rec.ruleId];
  return detail ? [head, ...detail(rec.evidence)] : [head];
}

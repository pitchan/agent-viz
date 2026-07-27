// evidence.js — turns each rule's measured numbers into French sentences.
//
// One entry per rule, in a table: a rule missing from here would display a
// recommendation with no figures, which the founding rule forbids. Kept apart
// from format.js because it changes for a different reason — a new rule, not a
// new display convention.

import { formatTokens, formatBytes } from './format.js';

const EVIDENCE_BY_RULE = {
  R1: e => [
    `${formatTokens(e.prefixChangeTokens)} jetons de préfixe reconstruit`,
    `dont ${formatTokens(e.modelSwitchTokens)} après un changement de modèle`,
    `${Math.round(e.shareOfNetPercent)} % des jetons nets de ces sessions`,
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
};

export function evidenceLines(rec) {
  const count = rec.evidence.sessions.length;
  const head = `${count} session${count > 1 ? 's' : ''} concernée${count > 1 ? 's' : ''}`;
  const detail = EVIDENCE_BY_RULE[rec.ruleId];
  return detail ? [head, ...detail(rec.evidence)] : [head];
}

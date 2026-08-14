'use strict';
// P3 (spec M1.1 §4): when the silent prefix breaks of an R1 card concentrate
// at the start of MCP sessions AND an R2 card is active for the same project,
// the cautious no-gesture text gives way to a pointer at that R2 card.
// Cross-RULE logic lives here, not inside a rule: each rule stays blind to
// the others (registry contract). Pure function, no I/O.
// Correlation only (×6.3 over 1,700 sessions): the wording carries the
// "étude" label and never claims causation.

import type { Recommendation } from './types.ts';

const EARLY_MCP_DOMINANCE = 0.5; // spec M1.1 §4 P3: strictly more than 50 % of noMarker tokens

const SEE_ALSO_ACTION =
  'Voir aussi : « MCP chargé mais rarement utilisé » — les cassures sans marqueur de ce projet se concentrent '
  + 'en début de session à serveurs MCP, cause probable (étude : corrélation ×6,3 sur 1 700 sessions, '
  + 'jamais une preuve causale).';

const qualifies = (rec: Recommendation): boolean =>
  rec.ruleId === 'R1'
  && rec.evidence.dominantMarker === 'noMarker'
  && rec.evidence.markerTokens.noMarker > 0
  && rec.evidence.noMarkerDetailTokens.earlyMcp / rec.evidence.markerTokens.noMarker > EARLY_MCP_DOMINANCE;

function applyCrossLinks(recs: Recommendation[]): Recommendation[] {
  const r2Projects = new Set(
    recs.filter(r => r.ruleId === 'R2').flatMap(r => r.evidence.projects ?? []));
  return recs.map(rec =>
    qualifies(rec) && r2Projects.has(rec.subject) ? { ...rec, action: SEE_ALSO_ACTION } : rec);
}

export { applyCrossLinks, EARLY_MCP_DOMINANCE, SEE_ALSO_ACTION };

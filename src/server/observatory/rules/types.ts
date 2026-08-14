'use strict';
// Shared shapes for the observatory rules — the registry contract every rule
// module implements, the session/context the engine hands to `evaluate`, and
// the draft recommendation each rule hands back (before the persistence layer
// adds id/status/timestamps — see ranking.ts, which types that later shape
// locally: only one file needs it, so it stays out of here).
//
// Promoted to its own file because the need crosses more than two files of
// this lot: all six rules, the registry, and cross-links all share it
// (precedent: doc/40-plan-etape4-langage task brief, "un fichier types.ts ne
// naît que si le besoin dépasse deux consommateurs").

export type ChurnStat = { events: number; tokens: number };

export type PrefixMarker = 'modelSwitch' | 'toolsAppeared' | 'noMarker';
export type PrefixDepth = 'facade' | 'd10to50' | 'd50to90' | 'tail';

export interface SessionReport {
  // Le moteur le rend null quand aucune ligne du transcript ne porte
  // meta.cwd (src/engine/doctor/report/types.ts:14, scan-session.ts l.32,
  // 47, 125) — cas réel, pas une garde de confort.
  cwd: string | null;
  context: {
    churnCauses: {
      growth: ChurnStat;
      compaction: ChurnStat;
      expiration: ChurnStat;
      prefixChange: ChurnStat;
      unknown: ChurnStat;
    };
    prefixBreakdown: {
      markers: Record<PrefixMarker, ChurnStat>;
      noMarkerDetail: { earlyMcp: ChurnStat; other: ChurnStat };
      depth: Record<PrefixDepth, ChurnStat>;
    };
    compactions: Array<{ trigger: string; preTokens: number | null }>;
  };
  reads: {
    totalBytes: number;
    cases: { crossAgentDuplicate: { count: number; bytes: number } };
  };
  toolResults: {
    byTool: Record<string, { count: number; bytes: number }>;
    totalBytes: number;
    candidateFilters: Array<{ family: string; count: number; bytes: number }>;
  };
  subagents: { sidecarCount: number; spawnToolUses: number; byType: Record<string, unknown> };
  tokens: {
    perAgent: Record<string, { in: number; out: number; cacheCreate: number; cacheRead: number }>;
  };
}

export interface Session {
  id: string;
  project: string;
  startedAt: string | null;
  endedAt: string | null;
  netTokens: number;
  costUsd: number;
  costComplete: boolean;
  report: SessionReport;
}

export interface ConfigItem {
  kind: string;
  name: string;
  scope: string;
  detail: unknown;
}

export interface EvaluationContext {
  sessions: Session[];
  configItems: ConfigItem[];
}

export type SubjectKind = 'project' | 'mcpServer' | 'tool';

// ─── Draft recommendations — one evidence shape per rule ───────────────────

export interface R1Evidence {
  sessions: string[];
  prefixChangeTokens: number;
  markerTokens: Record<PrefixMarker, number>;
  noMarkerDetailTokens: { earlyMcp: number; other: number };
  dominantMarker: PrefixMarker;
  depthTokens: Record<PrefixDepth, number>;
  dominantDepth: PrefixDepth;
  shareOfNetPercent: number;
  costComplete: boolean;
}
export interface R1Recommendation {
  ruleId: 'R1'; subject: string; title: string; category: string;
  confidence: 'fait'; estimatedCostUsd: number; costBasis: string;
  evidence: R1Evidence; action: string | null;
}

export interface R2Evidence {
  sessions: string[];
  scope: string;
  projects: string[];
  loadedSessions: number;
  usedSessions: number;
  loadedSharePercent: number;
  usedSharePercent: number;
  inventorySnapshot: boolean;
  costComplete: boolean;
}
export interface R2Recommendation {
  ruleId: 'R2'; subject: string; title: string; category: string;
  confidence: 'fait'; estimatedCostUsd: number; costBasis: string;
  evidence: R2Evidence; action: string;
}

export interface R3Evidence {
  sessions: string[];
  bytes: number;
  count: number;
  shareOfToolBytesPercent: number;
  costComplete: boolean;
}
export interface R3Recommendation {
  ruleId: 'R3'; subject: string; title: string; category: string;
  confidence: 'fait'; estimatedCostUsd: number; costBasis: string;
  evidence: R3Evidence; action: string;
}

export interface R4Evidence {
  sessions: string[];
  duplicateBytes: number;
  duplicateCount: number;
  readBytes: number;
  shareOfReadBytesPercent: number;
  costComplete: boolean;
}
export interface R4Recommendation {
  ruleId: 'R4'; subject: string; title: string; category: string;
  confidence: 'fait'; estimatedCostUsd: number; costBasis: string;
  evidence: R4Evidence; action: string;
}

export interface R5Evidence {
  sessions: string[];
  compactions: number;
  compactionsWithoutTokenCount: number;
  reprocessedTokens: number;
  costComplete: boolean;
}
export interface R5Recommendation {
  ruleId: 'R5'; subject: string; title: string; category: string;
  confidence: 'fait'; estimatedCostUsd: number; costBasis: string;
  evidence: R5Evidence; action: string;
}

export interface R6Evidence {
  sessions: string[];
  subagentTokens: number;
  spawns: number;
  medianDurationSeconds: number;
  costComplete: boolean;
}
export interface R6Recommendation {
  ruleId: 'R6'; subject: string; title: string; category: string;
  confidence: 'correlation'; estimatedCostUsd: number; costBasis: string;
  evidence: R6Evidence; action: string;
}

export type Recommendation =
  | R1Recommendation | R2Recommendation | R3Recommendation
  | R4Recommendation | R5Recommendation | R6Recommendation;

export interface Rule {
  id: string;
  category: string;
  subjectKind: SubjectKind;
  evaluate: (ctx: EvaluationContext) => Recommendation[];
}

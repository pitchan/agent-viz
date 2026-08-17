'use strict';
// Shared shapes for the observatory rules — the registry contract every rule
// module implements, the session/context the engine hands to `evaluate`, and
// the draft recommendation each rule hands back (before the persistence layer
// adds id/status/timestamps — see ranking.ts, which types that later shape
// locally: only one file needs it, so it stays out of here).
//
// Promoted to its own file because the need crosses more than two files of
// this lot: all seven rules, the registry, and cross-links all share it
// (precedent: doc/40-plan-etape4-langage task brief, "un fichier types.ts ne
// naît que si le besoin dépasse deux consommateurs").

export type ChurnStat = { events: number; tokens: number };

export type PrefixMarker = 'modelSwitch' | 'toolsAppeared' | 'noMarker';
export type PrefixDepth = 'facade' | 'd10to50' | 'd50to90' | 'tail';

// Forme de session posée par l'agrégateur du moteur (session-kind.ts) —
// interactive/headless/unknown. Stockée : une ligne écrite avant la migration
// M1.1 n'a pas la colonne et rend null, jamais une valeur devinée.
export type SessionKind = 'interactive' | 'headless' | 'unknown';

// Les six champs bruts d'usage (core/usage.ts côté moteur) — promu ici parce
// que la lot 5 des feuilles de l'observatoire en a besoin à plus de deux
// endroits (perAgent, perModel, total).
export interface TokenBucket {
  in: number;
  out: number;
  cacheCreate: number;
  cacheRead: number;
  cacheCreate1h: number;
  cacheCreate5m: number;
}

export interface SessionReport {
  // Le moteur le rend null quand aucune ligne du transcript ne porte
  // meta.cwd (src/engine/doctor/report/types.ts:14, scan-session.ts l.32,
  // 47, 125) — cas réel, pas une garde de confort.
  cwd: string | null;
  // Ajout consommé par le lot 6 (summary.ts) : le compte d'erreurs de parsing
  // de LA session, toujours présent sur un rapport frais du moteur
  // (src/engine/doctor/report/types.ts, champ top-level, jamais sous context) —
  // la surface « anomalies » du panneau résumé en a besoin par session, pas
  // seulement agrégé.
  parseErrors: number;
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
  // byType : mineur différé signalé au plan — la vraie forme rendue par
  // l'agrégateur de sous-agents est un compte, jamais une valeur opaque.
  subagents: { sidecarCount: number; spawnToolUses: number; byType: Record<string, number> };
  tokens: {
    perAgent: Record<string, TokenBucket>;
    // Ajouts consommés par le lot 5 (model-costs.ts, session-mapper.ts) :
    // perModel/total/unknownModels sortent de la MÊME accumulation que
    // perAgent et sont donc toujours présents. costByModel est l'exception —
    // champ de SCAN_VERSION 6 (scan-version.ts) : un rapport stocké avant
    // cette version ne l'a pas, et model-costs.ts exclut ces sessions des
    // lignes ET des totaux plutôt que de leur prêter une forme qu'elles n'ont
    // pas (compté dans excludedPendingRescan).
    perModel: Record<string, TokenBucket>;
    total: TokenBucket;
    unknownModels: string[];
    costByModel?: Record<string, { usd: number | null; pricing: string }>;
  };
  // Fait de SCAN_VERSION 8 (doc/41) : un rapport stocké avant ce bump ne le
  // porte pas — R7 écarte alors la session plutôt que de lui prêter une forme
  // (précédent : costByModel, v6). Vue restreinte de VerificationStats
  // (moteur) : les champs que les règles lisent ou liront (volets 2-3, doc/41)
  // sont déclarés ici.
  verification?: {
    verifications: number;
    verificationsFailed: number;
    lastVerification: { at: string; kind: string; ok: boolean; command: string } | null;
    editsTotal: number;
    editsAfterLastVerification: number;
    filesAfterLastVerificationTotal: number;
    tokensAfterLastVerification: number;
  };
}

export interface Session {
  id: string;
  project: string;
  startedAt: string | null;
  endedAt: string | null;
  // null : ligne stockée avant la migration M1.1 (store.ts), jamais devinée.
  sessionKind: SessionKind | null;
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

export interface R7Evidence {
  sessions: string[];
  sessionsNoVerification: number;
  sessionsWithTail: number;
  // Somme, PAR SESSION, des fichiers distincts laissés sans preuve — un même
  // fichier peut compter dans plusieurs sessions. L'union exacte n'est pas
  // calculable ici : la liste de noms du moteur est plafonnée (FILES_CAP), donc
  // le nom porte l'unité plutôt qu'un dédoublonnage qui serait faux.
  filesUnverifiedBySession: number;
  tokensAfterLastVerification: number;
  // Sessions du projet stockées avant SCAN_VERSION 8 : écartées du calcul —
  // jamais devinées, et jamais en silence (précédent : excludedPendingRescan
  // de model-costs.ts, v6).
  excludedPendingRescan: number;
  costComplete: boolean;
}
export interface R7Recommendation {
  ruleId: 'R7'; subject: string; title: string; category: string;
  confidence: 'fait'; estimatedCostUsd: number; costBasis: string;
  evidence: R7Evidence; action: string;
}

export type Recommendation =
  | R1Recommendation | R2Recommendation | R3Recommendation
  | R4Recommendation | R5Recommendation | R6Recommendation
  | R7Recommendation;

export interface Rule {
  id: string;
  category: string;
  subjectKind: SubjectKind;
  evaluate: (ctx: EvaluationContext) => Recommendation[];
}

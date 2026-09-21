import type { ContextStats } from '../aggregators/context.ts';
import type { PromptsStats } from '../aggregators/prompts.ts';
import type { ReadStats } from '../aggregators/reads.ts';
import type { SessionKind } from '../aggregators/session-kind.ts';
import type { SkillStats } from '../aggregators/skills.ts';
import type { SubagentStats } from '../aggregators/subagents.ts';
import type { TokensResult } from '../aggregators/tokens.ts';
import type { ToolResultStats } from '../aggregators/tool-results.ts';
import type { VerificationStats } from '../aggregators/verification.ts';

/** Le contrat de sortie --json : des FAITS mesurés, jamais un gain projeté. */
export interface SessionReport {
  sessionId: string;
  projectSlug: string;
  cwd: string | null;
  gitBranch: string | null;
  clientVersions: string[];
  startedAt: string | null;
  /** Dernier horodatage d'événement de l'agent principal — avec startedAt, la durée de session. */
  endedAt: string | null;
  /** Forme de session : interactive (prompts humains — marqueurs de saisie promptSource "typed"/origin.kind "human", ou blocs), headless (≥ 1 prompt en chaîne sans marqueur humain — claude -p, script), unknown (aucun prompt exploitable). Fait, jamais un jugement. */
  sessionKind: SessionKind;
  tokens: TokensResult;
  /** Convention du repo : input + cache_creation + output, cache_read exclu. */
  netTokens: number;
  toolResults: ToolResultStats;
  /** Ventilation des lectures Read (relectures identiques/modifiées, doublons inter-agents). */
  reads: ReadStats;
  subagents: SubagentStats;
  context: ContextStats;
  prompts: PromptsStats;
  /** Queue non vérifiée : dernière vérification de la session et ce qui l'a suivie. */
  verification: VerificationStats;
  /** Skills listés dans la session et appels de l'outil Skill — faits bruts. */
  skills: SkillStats;
  events: number;
  parseErrors: number;
  otherEventTypes: Record<string, number>;
  /** Raison si la session n'a pas pu être lue (le scan continue, jamais silencieux). */
  skipped?: string;
}

export interface AggregateTotals {
  sessions: number;
  netTokens: number;
  /** Somme de la part au tarif CONNU seulement. */
  costUsd: number;
  costComplete: boolean;
  toolResultBytes: number;
  /** Octets des tool_results dans la fenêtre utile de compression, 2–30 Ko. */
  bandBytes: number;
  subagentSidecars: number;
  mapShapedPrompts: number;
  totalPrompts: number;
}

export interface ProjectReport {
  projectSlug: string;
  cwd: string | null;
  /** État ACTUEL du disque — approximation, le contenu historique est inconnu. */
  claudeMdFiles: { path: string; bytes: number }[];
  sessions: SessionReport[];
  totals: AggregateTotals;
}

export interface DoctorReport {
  generatedAt: string;
  claudeDir: string;
  filters: { project?: string; since?: string; last?: number };
  scan: {
    sessions: number;
    skippedSessions: number;
    events: number;
    parseErrors: number;
    malformedUsageMessages: number;
    otherEventTypes: Record<string, number>;
    unknownModels: string[];
    clientVersions: string[];
  };
  projects: ProjectReport[];
  totals: AggregateTotals;
}

import type { ContextStats } from '../aggregators/context.js';
import type { PromptsStats } from '../aggregators/prompts.js';
import type { ReadStats } from '../aggregators/reads.js';
import type { SessionKind } from '../aggregators/session-kind.js';
import type { SubagentStats } from '../aggregators/subagents.js';
import type { TokensResult } from '../aggregators/tokens.js';
import type { ToolResultStats } from '../aggregators/tool-results.js';
import type { TurnsStats } from '../aggregators/turns.js';
import type { VerificationStats } from '../aggregators/verification.js';

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
  /** Ventilation J8 des lectures Read (relectures identiques/modifiées, doublons inter-agents). */
  reads: ReadStats;
  subagents: SubagentStats;
  context: ContextStats;
  prompts: PromptsStats;
  /** Découpage « gain vécu » : la dépense rattachée à chaque question, classée par le détecteur du router. */
  turns: TurnsStats;
  /** Queue non vérifiée (doc/41) : dernière vérification de la session et ce qui l'a suivie. */
  verification: VerificationStats;
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
  /** Octets des tool_results dans la fenêtre 2–30 Ko (l'habitat du futur gate). */
  bandBytes: number;
  subagentSidecars: number;
  mapShapedPrompts: number;
  totalPrompts: number;
  /** Tours « gain vécu » : questions humaines non-bruit, dont tirées par le détecteur du router. */
  turns: number;
  triggeredTurns: number;
  /** Jetons nets des tours tirés / silencieux / non-attribuables — la base de la projection au rendu. */
  triggeredNetTokens: number;
  silentNetTokens: number;
  turnsUnattributedNetTokens: number;
  /** Gestes de graphe de l'AGENT (comportement-agent) : compte total puis composition par geste. */
  agentGestureEvents: number;
  agentGrepGestures: number;
  agentBashGestures: number;
  agentSpawnGestures: number;
  /** Tours SANS question de graphe mais où l'agent a fait le geste — l'angle mort de v0.7.0, en tours et jetons nets. */
  agentOnlyTurns: number;
  agentOnlyNetTokens: number;
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
    otherEventTypes: Record<string, number>;
    unknownModels: string[];
    clientVersions: string[];
  };
  projects: ProjectReport[];
  totals: AggregateTotals;
}

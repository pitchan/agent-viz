// Le contrat que chaque adaptateur de transcript honore, et que index.ts impose au registre.

import type { RawUsage } from '../../engine/core/events.ts';
import type { UsageRecord } from './claude.ts';

export type UsageSnapshot =
  | { ok: true; calls: { id: string; model: string; usage: RawUsage }[] }
  | { ok: false; reason: string };

// Pour un agent dont les jetons ne sont pas dans le transcript mais dans un fichier relu en entier.
export interface UsageSnapshotSource {
  /** Empreinte de l'état du fichier ; `null` tant qu'il n'existe pas. */
  stamp(transcriptPath: string): string | null;
  read(transcriptPath: string): UsageSnapshot;
}

/** Le transcript propre d'un sous-agent, tel qu'un événement du hook le désigne. */
export interface SubagentTranscript {
  agentId: string;
  path: string;
}

export interface TranscriptAdapter {
  tokensSupported: boolean;
  discoverPath(firstEvent: unknown): string | null;
  /** `null` quand l'agent ne désigne pas ses sous-agents par ses événements. */
  subagentTranscript(evt: unknown): SubagentTranscript | null;
  extractPrompt(text: string): string | null;
  /** `agentId` : la ligne vient du transcript propre de ce sous-agent ; absent pour le transcript de la session. */
  parseUsageLine(line: string, rec: UsageRecord, agentId?: string): boolean;
  usageSnapshot: UsageSnapshotSource | null;
}

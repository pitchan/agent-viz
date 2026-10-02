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

export interface TranscriptAdapter {
  tokensSupported: boolean;
  discoverPath(firstEvent: unknown): string | null;
  extractPrompt(text: string): string | null;
  parseUsageLine(line: string, rec: UsageRecord): boolean;
  usageSnapshot: UsageSnapshotSource | null;
}

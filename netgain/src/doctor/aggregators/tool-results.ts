import type { NormalizedEvent, ToolUseRef } from '../../core/events.js';
import { familyOf, recognizeCommand } from './recognizers.js';

type ToolResultEvent = Extract<NormalizedEvent, { kind: 'tool_result' }>;

/** Fenêtre utile de compression mesurée par la saga : 2–30 Ko (au-delà, l'hôte tronque). */
const BAND_MIN = 2048;
const BAND_MAX = 30 * 1024;

export interface CountBytes {
  count: number;
  bytes: number;
}

function cb(): CountBytes {
  return { count: 0, bytes: 0 };
}

export interface FamilyStat {
  family: string;
  count: number;
  bytes: number;
  recognizer: string | null;
}

export interface ToolResultStats {
  totalResults: number;
  totalBytes: number;
  bySize: { small: CountBytes; band: CountBytes; large: CountBytes };
  byTool: Record<string, CountBytes>;
  byRecognizer: Record<string, CountBytes & { bandBytes: number }>;
  families: FamilyStat[];
  /** Octets des familles répétées (≥3 occurrences) — là où un filtre composerait. */
  repetitiveBytes: number;
  /** Familles répétées, non reconnues, ≥2 Ko de moyenne : les filtres qui manquent au gate. */
  candidateFilters: { family: string; count: number; bytes: number }[];
}

/**
 * Métrique 2 : distribution des tool_results. Le tool_use précède toujours son
 * résultat dans le transcript ; on apparie par tool_use_id.
 */
export class ToolResultsAggregator {
  private readonly toolUses = new Map<string, ToolUseRef>();
  private readonly bySize = { small: cb(), band: cb(), large: cb() };
  private readonly byTool: Record<string, CountBytes> = {};
  private readonly byRecognizer: Record<string, CountBytes & { bandBytes: number }> = {};
  private readonly families = new Map<string, { count: number; bytes: number; recognizer: string | null }>();
  private totalResults = 0;
  private totalBytes = 0;

  registerToolUse(ref: ToolUseRef): void {
    this.toolUses.set(ref.id, ref);
  }

  addToolResult(evt: ToolResultEvent): void {
    const use = this.toolUses.get(evt.toolUseId);
    const toolName = use?.name ?? '(inconnu)';
    this.totalResults += 1;
    this.totalBytes += evt.bytes;

    const size = evt.bytes < BAND_MIN ? this.bySize.small : evt.bytes <= BAND_MAX ? this.bySize.band : this.bySize.large;
    size.count += 1;
    size.bytes += evt.bytes;

    const tool = (this.byTool[toolName] ??= cb());
    tool.count += 1;
    tool.bytes += evt.bytes;

    const input = use !== undefined && typeof use.input === 'object' && use.input !== null ? (use.input as Record<string, unknown>) : {};
    const command = typeof input['command'] === 'string' ? input['command'] : null;
    const recognizer = command !== null ? recognizeCommand(command) : null;
    if (recognizer !== null) {
      const rec = (this.byRecognizer[recognizer] ??= { count: 0, bytes: 0, bandBytes: 0 });
      rec.count += 1;
      rec.bytes += evt.bytes;
      if (evt.bytes >= BAND_MIN && evt.bytes <= BAND_MAX) rec.bandBytes += evt.bytes;
    }

    if (use !== undefined) {
      const family = familyOf(toolName, use.input);
      const stat = this.families.get(family) ?? { count: 0, bytes: 0, recognizer: null };
      stat.count += 1;
      stat.bytes += evt.bytes;
      if (recognizer !== null) stat.recognizer = recognizer;
      this.families.set(family, stat);
    }
  }

  result(): ToolResultStats {
    const families: FamilyStat[] = [...this.families.entries()]
      .map(([family, s]) => ({ family, count: s.count, bytes: s.bytes, recognizer: s.recognizer }))
      .sort((a, b) => b.bytes - a.bytes);
    const repetitive = families.filter((f) => f.count >= 3);
    const candidateFilters = repetitive
      .filter((f) => f.recognizer === null && f.bytes / f.count >= BAND_MIN)
      .map((f) => ({ family: f.family, count: f.count, bytes: f.bytes }));
    return {
      totalResults: this.totalResults,
      totalBytes: this.totalBytes,
      bySize: this.bySize,
      byTool: this.byTool,
      byRecognizer: this.byRecognizer,
      families,
      repetitiveBytes: repetitive.reduce((sum, f) => sum + f.bytes, 0),
      candidateFilters,
    };
  }
}

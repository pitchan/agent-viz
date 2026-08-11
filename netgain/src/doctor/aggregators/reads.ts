import type { NormalizedEvent, ToolUseRef } from '../../core/events.js';

type ToolResultEvent = Extract<NormalizedEvent, { kind: 'tool_result' }>;

/**
 * Cases du plan J8 (dépôt privé, cf. docs/sources-externes.md) :
 * - firstRead : première lecture, la base irréductible ;
 * - identicalReread : même agent, même chemin+plage, même empreinte — le gisement du dédoublonneur ;
 * - modifiedReread : même clé, empreinte différente — irréductible par dédoublonnage ;
 * - crossAgentDuplicate : autre agent de la session, même chemin+plage+empreinte — gisement map-server, pas gate ;
 * - error : is_error, compté à part, jamais classé.
 */
export type ReadCase = 'firstRead' | 'identicalReread' | 'modifiedReread' | 'crossAgentDuplicate' | 'error';

export interface ReadCaseStat {
  count: number;
  bytes: number;
}

export interface ReadStats {
  totalResults: number;
  totalBytes: number;
  /** Invariant : la somme des cases = les deux totaux ci-dessus. */
  cases: Record<ReadCase, ReadCaseStat>;
}

export function emptyReadCases(): Record<ReadCase, ReadCaseStat> {
  return {
    firstRead: { count: 0, bytes: 0 },
    identicalReread: { count: 0, bytes: 0 },
    modifiedReread: { count: 0, bytes: 0 },
    crossAgentDuplicate: { count: 0, bytes: 0 },
    error: { count: 0, bytes: 0 },
  };
}

/**
 * Métrique J8 : ventilation des lectures Read par session. Périmètre v1 : l'outil
 * Read seul (la famille `cat` Bash est une extension future). Mémoire O(1) par
 * clé : seules les empreintes sont conservées, jamais le contenu.
 */
export class ReadsAggregator {
  /** toolUseId → clé chemin+plage (seuls les tool_use Read sont retenus). */
  private readonly readUses = new Map<string, string>();
  /** `${agentKey}|${clé}` → dernière empreinte vue par CET agent (null = contenu vide). */
  private readonly lastHashByAgent = new Map<string, string | null>();
  /** `${clé}#${empreinte}` vus par n'importe quel agent de la session. */
  private readonly seenInSession = new Set<string>();
  private readonly cases = emptyReadCases();
  private totalResults = 0;
  private totalBytes = 0;

  registerToolUse(ref: ToolUseRef): void {
    if (ref.name !== 'Read') return;
    const input = typeof ref.input === 'object' && ref.input !== null ? (ref.input as Record<string, unknown>) : {};
    const filePath = typeof input['file_path'] === 'string' ? input['file_path'] : null;
    if (filePath === null) return;
    const offset = typeof input['offset'] === 'number' ? input['offset'] : '';
    const limit = typeof input['limit'] === 'number' ? input['limit'] : '';
    this.readUses.set(ref.id, `${filePath}@${offset}-${limit}`);
  }

  addToolResult(evt: ToolResultEvent, agentKey: string): void {
    const fileKey = this.readUses.get(evt.toolUseId);
    if (fileKey === undefined) return; // pas une lecture Read
    this.totalResults += 1;
    this.totalBytes += evt.bytes;
    if (evt.isError) {
      this.bump('error', evt.bytes);
      return;
    }
    const agentFileKey = `${agentKey}|${fileKey}`;
    const prevHash = this.lastHashByAgent.get(agentFileKey);
    const hash = evt.contentHash;
    let readCase: ReadCase;
    if (prevHash !== undefined) {
      // Identique seulement si prouvé (deux empreintes non nulles égales) — jamais deviné.
      readCase = hash !== null && prevHash === hash ? 'identicalReread' : 'modifiedReread';
    } else if (hash !== null && this.seenInSession.has(`${fileKey}#${hash}`)) {
      readCase = 'crossAgentDuplicate';
    } else {
      readCase = 'firstRead';
    }
    this.lastHashByAgent.set(agentFileKey, hash);
    if (hash !== null) this.seenInSession.add(`${fileKey}#${hash}`);
    this.bump(readCase, evt.bytes);
  }

  private bump(readCase: ReadCase, bytes: number): void {
    this.cases[readCase].count += 1;
    this.cases[readCase].bytes += bytes;
  }

  result(): ReadStats {
    return { totalResults: this.totalResults, totalBytes: this.totalBytes, cases: this.cases };
  }
}

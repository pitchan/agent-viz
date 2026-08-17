// La queue non vérifiée par session (doc/41).
//
// Fait mesuré, jamais un jugement : quelles modifications de fichiers sont
// postérieures à la dernière commande de vérification DE LA SESSION, et
// combien de jetons nets ont été émis après cette dernière preuve. Une
// vérification lancée hors session (terminal humain, CI) est invisible ici —
// le produit dit toujours « dans la session ».
//
// Fusion inter-agents par horodatage au bilan : scanSession lit le transcript
// principal PUIS chaque sous-agent, l'ordre de lecture n'est donc pas l'ordre
// du temps. Un événement sans horodatage exploitable est compté (`unordered`),
// jamais classé au hasard. Limite v1 assumée : un fichier modifié par commande
// shell (sed, redirection) est invisible — seuls Edit/Write/MultiEdit/
// NotebookEdit comptent comme éditions.

import type { NormalizedEvent } from '../../core/events.js';
import { addUsage, emptyUsageBucket, isDedupableMsgId } from '../../core/usage.js';
import { netTokens } from './tokens.js';
import { classifyVerification } from '../verification-commands.js';
import type { VerificationKind } from '../verification-commands.js';

type AssistantEvent = Extract<NormalizedEvent, { kind: 'assistant' }>;
type ToolResultEvent = Extract<NormalizedEvent, { kind: 'tool_result' }>;

export interface VerificationRecord {
  at: string;
  kind: VerificationKind;
  ok: boolean;
  /** Tronquée à COMMAND_MAX : une adresse de preuve, pas un contenu. */
  command: string;
}

export interface VerificationStats {
  verifications: number;
  verificationsFailed: number;
  firstVerification: VerificationRecord | null;
  lastVerification: VerificationRecord | null;
  editsTotal: number;
  editedFiles: number;
  firstEditAt: string | null;
  editsAfterLastVerification: number;
  filesAfterLastVerificationTotal: number;
  /** Distincts, triés, plafonnés à FILES_CAP — le total ci-dessus dit la coupe. */
  filesAfterLastVerification: string[];
  /** Jetons nets émis après la dernière vérification (toute la session si aucune). */
  tokensAfterLastVerification: number;
  /** Enregistrements sans horodatage exploitable, exclus de la chronologie. */
  unordered: number;
}

const COMMAND_TOOLS = new Set(['Bash', 'PowerShell']);
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const COMMAND_MAX = 200;
const FILES_CAP = 20;

interface PendingVerification { kind: VerificationKind; command: string; at: string | undefined }
interface PendingEdit { path: string; at: string | undefined }

export class VerificationAggregator {
  private readonly pendingVerifs = new Map<string, PendingVerification>();
  private readonly pendingEdits = new Map<string, PendingEdit>();
  private readonly verifs: Array<{ t: number; rec: VerificationRecord }> = [];
  private readonly edits: Array<{ t: number; at: string; path: string }> = [];
  private readonly usageSeen = new Set<string>();
  private readonly usages: Array<{ t: number; net: number }> = [];
  private unordered = 0;

  addAssistant(evt: AssistantEvent, agentKey: string): void {
    for (const tu of evt.toolUses) {
      const input = typeof tu.input === 'object' && tu.input !== null
        ? (tu.input as Record<string, unknown>) : {};
      if (COMMAND_TOOLS.has(tu.name)) {
        const command = typeof input['command'] === 'string' ? input['command'] : null;
        const kind = command === null ? null : classifyVerification(command);
        if (command !== null && kind !== null) {
          this.pendingVerifs.set(tu.id, { kind, command: command.slice(0, COMMAND_MAX), at: evt.timestamp });
        }
      } else if (EDIT_TOOLS.has(tu.name)) {
        const path = typeof input['file_path'] === 'string' ? input['file_path']
          : typeof input['notebook_path'] === 'string' ? input['notebook_path'] : null;
        if (path !== null) this.pendingEdits.set(tu.id, { path, at: evt.timestamp });
      }
    }
    if (evt.usage !== null) {
      if (isDedupableMsgId(evt.msgId)) {
        const key = `${agentKey}:${evt.msgId}`;
        if (this.usageSeen.has(key)) return;
        this.usageSeen.add(key);
      }
      const bucket = emptyUsageBucket();
      addUsage(bucket, evt.usage);
      const t = toMs(evt.timestamp);
      if (Number.isNaN(t)) this.unordered += 1;
      this.usages.push({ t, net: netTokens(bucket) });
    }
  }

  addToolResult(evt: ToolResultEvent): void {
    const verif = this.pendingVerifs.get(evt.toolUseId);
    if (verif !== undefined) {
      this.pendingVerifs.delete(evt.toolUseId);
      const at = evt.timestamp ?? verif.at;
      const t = toMs(at);
      if (at === undefined || Number.isNaN(t)) { this.unordered += 1; return; }
      this.verifs.push({ t, rec: { at, kind: verif.kind, ok: !evt.isError, command: verif.command } });
      return;
    }
    const edit = this.pendingEdits.get(evt.toolUseId);
    if (edit !== undefined) {
      this.pendingEdits.delete(evt.toolUseId);
      if (evt.isError) return; // une édition refusée n'a rien modifié
      const at = evt.timestamp ?? edit.at;
      const t = toMs(at);
      if (at === undefined || Number.isNaN(t)) { this.unordered += 1; return; }
      this.edits.push({ t, at, path: edit.path });
    }
  }

  result(): VerificationStats {
    this.verifs.sort((a, b) => a.t - b.t);
    this.edits.sort((a, b) => a.t - b.t);
    const last = this.verifs.at(-1) ?? null;
    // Sans aucune vérification, TOUT est « après » : la chronologie n'est pas requise.
    const after = last === null ? this.edits : this.edits.filter(e => e.t > last.t);
    const files = [...new Set(after.map(e => e.path))].sort();
    const tokensAfter = last === null
      ? this.usages.reduce((acc, u) => acc + u.net, 0)
      : this.usages.reduce((acc, u) => acc + (u.t > last.t ? u.net : 0), 0);
    return {
      verifications: this.verifs.length,
      verificationsFailed: this.verifs.filter(v => !v.rec.ok).length,
      firstVerification: this.verifs[0]?.rec ?? null,
      lastVerification: last?.rec ?? null,
      editsTotal: this.edits.length,
      editedFiles: new Set(this.edits.map(e => e.path)).size,
      firstEditAt: this.edits[0]?.at ?? null,
      editsAfterLastVerification: after.length,
      filesAfterLastVerificationTotal: files.length,
      filesAfterLastVerification: files.slice(0, FILES_CAP),
      tokensAfterLastVerification: tokensAfter,
      unordered: this.unordered,
    };
  }
}

function toMs(at: string | undefined): number {
  return at === undefined ? Number.NaN : Date.parse(at);
}

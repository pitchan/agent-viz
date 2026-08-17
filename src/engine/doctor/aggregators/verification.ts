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
//
// Ce qui est STOCKÉ d'une commande, et ce qui ne l'est pas : le texte de la
// première et de la dernière vérification, tronqué à 200 caractères — une
// adresse de preuve, pas un contenu — et débarrassé de ses affectations
// `NOM=valeur`, où qu'elles soient dans la chaîne. Le classement, lui, reçoit
// toujours la commande entière.
//
// Fenêtre de recouvrement en parallèle : une édition faite par un sous-agent
// PENDANT un long test est datée AVANT le résultat de ce test, donc dite
// couverte alors qu'elle ne l'est pas. Le biais va dans le sens conservateur —
// le produit SOUS-déclare la queue plutôt que d'accuser à tort — et la
// frontière est stricte pour la même raison : à la milliseconde exacte du
// résultat, l'édition est comptée couverte.
//
// Seconde limite, déclarée au même titre : `ok` reflète le code de retour du
// shell, pas le verdict de l'outil — un tube sans pipefail
// (`npm test 2>&1 | tail -20` rend le code de `tail`) ou un `|| true` peut
// rendre un vert optimiste ; déclaré, pas corrigé (doc/41). Ce qui NE relève
// pas de la déclaration mais du refus : un lancement en arrière-plan, dont le
// résultat est un accusé de départ et non un verdict — celui-là n'est pas
// enregistré du tout (doc/41, D4 : une fausse preuve se paie).

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

// `command` entre dans le rapport PERSISTÉ : un `NPM_TOKEN=abc npm test` y
// entrerait verbatim. Les affectations d'environnement sont donc retirées avant
// stockage — PARTOUT dans la chaîne, et pas seulement en tête : l'ancrage en `^`
// laissait passer `cd repo && NPM_TOKEN=xxx npm test` (composé) et coupait
// `TOKEN="a b" npm test` au premier espace, laissant `b" npm test`. L'alternance
// reconnaît donc aussi les valeurs entre guillemets, doubles ou simples.
// La CLASSIFICATION, elle, reçoit toujours la commande entière — le classifieur
// tolère déjà ces préfixes, seul le stockage est nettoyé.
//
// Deux conséquences assumées, pour qu'elles ne se relisent pas comme des
// défauts. `\S*` et non `\S+` : `FOO=` (valeur vide) était déjà retiré par la
// forme ancrée, et le passer à `\S+` aurait été une régression. Et un drapeau
// long à valeur (`--reporter=json`) est retiré lui aussi, ne laissant que
// `--` : c'est le prix du filet large, et il va dans le bon sens — un
// `--token=…` est exactement ce qu'on ne veut pas persister. Ce qui est stocké
// est une ADRESSE de preuve, jamais une commande à rejouer.
const ENV_ASSIGNMENT = /\w+=(?:"[^"]*"|'[^']*'|\S*)/g;

/** Le texte gardé pour le rapport : expurgé, réduit à une ligne, puis tronqué. */
function storableCommand(command: string): string {
  return command.replace(ENV_ASSIGNMENT, '').replace(/\s+/g, ' ').trim().slice(0, COMMAND_MAX);
}

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
        // Un lancement en arrière-plan rend un ACCUSÉ DE DÉPART, jamais un
        // rouge/vert : l'enregistrer fabriquerait un `ok: true` sans preuve.
        if (input['run_in_background'] === true) continue;
        const command = typeof input['command'] === 'string' ? input['command'] : null;
        const kind = command === null ? null : classifyVerification(command);
        if (command !== null && kind !== null) {
          this.pendingVerifs.set(tu.id, { kind, command: storableCommand(command), at: evt.timestamp });
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

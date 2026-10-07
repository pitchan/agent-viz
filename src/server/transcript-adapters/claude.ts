'use strict';
// Claude Code transcript adapter.
//
// Discovery: Claude Code stamps `transcript_path` on every hook event,
// including SessionStart. So pulling it from the first event works.
//
// Schema — three line shapes carry token usage:
//   - main thread: assistant lines with `isSidechain:false`, usage at
//     `evt.message.usage`.
//   - sub-agent (Claude Code ≥ ~2.1.143): each sub-agent gets its own
//     transcript file (<session>/subagents/agent-<id>.jsonl); its assistant
//     lines carry `isSidechain:true` + a top-level `agentId`, usage at
//     `evt.message.usage` (same shape as the main thread).
//   - sub-agent (legacy, Claude Code ≤ ~2.1.81): activity streamed inline in
//     the parent transcript as `agent_progress` events, usage nested at
//     `evt.data.message.message.usage`.

import { ensureTokens, accumulateUsage, newBucket } from '../tokens.ts';
import { decodeJsonlLine } from '../../engine/core/jsonl.ts';
import type { JsonlLine } from '../../engine/core/jsonl.ts';

// Frontière avec `tokens.ts`, dont la forme complète n'est pas exportée. Ceci
// n'engage que ce que CE fichier lit et écrit — le seau
// lui-même (`main`, chaque valeur de `perAgent`) reste `unknown` : ni
// `parseUsageLine` ni `getOrCreateBucket` ne regardent ses champs, ils le
// font seulement transiter vers `accumulateUsage`.
interface TokenState {
  main: unknown;
  perAgent: Map<string, unknown>;
  // Un lecteur le pose quand il refuse un transcript dont les chiffres ne seraient pas fiables.
  unsupported?: boolean;
}

// Exporté en TYPE seulement pour que `copilot.ts` partage exactement la même
// forme de paramètre (contrat de Liskov du registre — voir index.ts) sans
// dupliquer la déclaration.
export interface UsageRecord {
  tokens?: TokenState;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// Seule l'absence écarte une ligne : un `usage` qui n'est pas un objet (`0`, `"x"`)
// va jusqu'à `accumulateUsage`, qui le compte à part et rend la session partielle,
// au lieu de disparaître ici sans trace.
function isAbsent(v: unknown): v is undefined | null {
  return v === undefined || v === null;
}

function asString(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function discoverPath(firstEvent: unknown): string | null {
  if (!isRecord(firstEvent)) return null;
  return asString(firstEvent.transcript_path);
}

interface ExtractedUsage {
  usage: unknown;
  model: string | null;
  msgId: string | null;
  key: string;
}

// main thread: `isSidechain:false`, usage at `evt.message.usage`.
function extractMainUsage(evt: Record<string, unknown>): ExtractedUsage | null {
  if (evt.isSidechain !== false || evt.type !== 'assistant') return null;
  if (!isRecord(evt.message) || isAbsent(evt.message.usage)) return null;
  return {
    usage: evt.message.usage,
    model: asString(evt.message.model),
    msgId: asString(evt.message.id),
    key: '__main__',
  };
}

// sub-agent (Claude Code ≥ ~2.1.143): own transcript file, `isSidechain:true`
// + top-level `agentId`, usage at the same `evt.message.usage` shape.
function extractSubagentUsage(evt: Record<string, unknown>): ExtractedUsage | null {
  if (evt.isSidechain !== true || evt.type !== 'assistant') return null;
  const agentId = asString(evt.agentId);
  if (!agentId || !isRecord(evt.message) || isAbsent(evt.message.usage)) return null;
  return {
    usage: evt.message.usage,
    model: asString(evt.message.model),
    msgId: asString(evt.message.id),
    key: agentId,
  };
}

// sub-agent (legacy, Claude Code ≤ ~2.1.81): `agent_progress` events, usage
// nested at `evt.data.message.message.usage`.
function extractLegacyProgressUsage(evt: Record<string, unknown>): ExtractedUsage | null {
  if (evt.type !== 'progress' || !isRecord(evt.data) || evt.data.type !== 'agent_progress') return null;
  const agentId = asString(evt.data.agentId);
  if (!agentId) return null;
  const outer = isRecord(evt.data.message) ? evt.data.message : null;
  const inner = outer && isRecord(outer.message) ? outer.message : null;
  if (!inner || isAbsent(inner.usage)) return null;
  return {
    usage: inner.usage,
    model: asString(inner.model),
    msgId: asString(inner.id),
    key: agentId,
  };
}

function getOrCreateBucket(tokens: TokenState, key: string): unknown {
  if (key === '__main__') return tokens.main;
  let bucket = tokens.perAgent.get(key);
  if (bucket === undefined) {
    bucket = newBucket();
    tokens.perAgent.set(key, bucket);
  }
  return bucket;
}

function parseUsageLine(line: string, rec: UsageRecord): boolean {
  if (!line || line.indexOf('"usage"') === -1) return false;
  // Le verdict sur une ligne vient de la primitive commune : une ligne d'usage préfixée d'un BOM est
  // comptée, sur un site qui lit la queue du transcript en direct — une ligne perdue ici, aucune
  // relecture ne la rattrape. La pré-garde ci-dessus écarte sans analyse les lignes sans usage.
  const verdict: JsonlLine | null = decodeJsonlLine(line);
  if (!verdict || !verdict.ok) return false;
  const evt = verdict.value;
  if (!isRecord(evt)) return false;

  // Anthropic message id — single source of truth for dedup. Claude Code
  // splits one API message into one JSONL line per content block (thinking,
  // text, tool_use), each carrying the SAME usage object; without dedup the
  // bucket sums the same usage N times. The id lives at `message.id` in all
  // three modern shapes and at `data.message.message.id` for legacy progress.
  const extracted = extractMainUsage(evt) ?? extractSubagentUsage(evt) ?? extractLegacyProgressUsage(evt);
  if (!extracted) return false;

  ensureTokens(rec);
  const tokens = rec.tokens;
  if (!tokens) return false;
  const bucket = getOrCreateBucket(tokens, extracted.key);

  // Top-level `timestamp` (all three shapes) dates the message so pricing can
  // apply the tariff in effect when it was produced, not at parse time.
  accumulateUsage(bucket, extracted.usage, extracted.model, extracted.msgId, asString(evt.timestamp));
  return true;
}

// ── Prompt extraction ──

// Strip tagged blocks (<tag>content</tag>) and standalone tags, then trim.
function cleanUserText(raw: string): string {
  return raw.replace(/<(\w[\w-]*)[\s>][\s\S]*?<\/\1>/g, '').replace(/<[^>]+>/g, '').trim();
}

// Check if text is IDE/system noise rather than a real user prompt.
function isNoise(text: string): boolean {
  return /^(The user (opened|is viewing|has selected|scrolled)|ide_selection|gitStatus:|Current branch:)/i.test(text);
}

// Extract the first real user prompt from a transcript buffer.
function extractPrompt(content: string): string | null {
  const lines = content.split('\n');
  for (const line of lines) {
    // Le verdict vient de la primitive commune. Un échec reste muet ici : la fenêtre lue est
    // bornée (256 Ko puis 1 Mo) et coupe en plein milieu de ligne, donc une trace se
    // déclencherait à chaque lecture — du bruit de routine, pas un signal.
    //
    // Le `try` rattrape deux levées, `cleanUserText(block.text)` sur un bloc `text` sans `text`
    // et `block.type` sur un bloc `null` : la ligne ENTIÈRE est abandonnée, frères valides
    // compris. Un garde `isRecord(block)` sauterait le seul bloc cassé et changerait qui gagne.
    const verdict = decodeJsonlLine(line);
    if (!verdict || !verdict.ok) continue;
    const o = verdict.value;
    if (!isRecord(o)) continue;
    try {
      if (o.type === 'user' || o.type === 'human') {
        const message = isRecord(o.message) ? o.message : null;
        const c: unknown = (message && message.content) || o.content;
        if (typeof c === 'string') {
          const clean = cleanUserText(c);
          if (clean && clean.length > 5 && !isNoise(clean)) return clean.slice(0, 120);
        }
        if (Array.isArray(c)) {
          const blocks: unknown[] = c;
          for (const block of blocks) {
            // Cast, jamais `isRecord` : un bloc `null`/`undefined` doit lever
            // ICI — voir le commentaire au-dessus du `try`.
            const b = block as { type?: unknown; text?: unknown };
            if (b.type === 'text') {
              const text = cleanUserText(b.text as string);
              if (text && text.length > 5 && !text.startsWith('{') && !isNoise(text)) return text.slice(0, 120);
            }
          }
        }
      }
    } catch {}
  }
  return null;
}

const tokensSupported = true;
// Les jetons de Claude sont dans le transcript, lus ligne à ligne par `parseUsageLine`.
const usageSnapshot = null;

export {
  tokensSupported,
  discoverPath,
  extractPrompt,
  parseUsageLine,
  usageSnapshot,
};

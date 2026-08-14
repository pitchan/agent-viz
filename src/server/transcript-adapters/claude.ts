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
import { decodeJsonlLine } from '../jsonl.ts';

// Frontière avec `tokens.ts` (hors lot : sa forme complète y vit encore en
// implicite). Ceci n'engage que ce que CE fichier lit et écrit — le seau
// lui-même (`main`, chaque valeur de `perAgent`) reste `unknown` : ni
// `parseUsageLine` ni `getOrCreateBucket` ne regardent ses champs, ils le
// font seulement transiter vers `accumulateUsage`.
interface TokenState {
  main: unknown;
  perAgent: Map<string, unknown>;
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
  if (!isRecord(evt.message) || !evt.message.usage) return null;
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
  if (!agentId || !isRecord(evt.message) || !evt.message.usage) return null;
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
  if (!inner || !inner.usage) return null;
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
  // C2 : le verdict sur une ligne vient de la primitive commune du moteur, il
  // n'est plus réimplémenté ici. Ce que la migration change pour l'appelant :
  // une ligne d'usage préfixée d'un BOM est désormais comptabilisée au lieu
  // d'être perdue en silence, alors que ce site lit la queue du transcript en
  // direct — une ligne perdue ici est une ligne qu'aucune relecture ne
  // rattrape. La pré-garde ci-dessus, elle, reste : elle ne décode rien, elle
  // écarte sans analyser les lignes sans usage sur un chemin parcouru à chaque
  // ligne écrite.
  //
  // Annotation à la frontière : `decodeJsonlLine` vient de `../jsonl.ts`, pas
  // encore typé (lot 7, un des six ponts de traversée du moteur). Sa forme
  // réelle — `{ ok: true; value: unknown } | { ok: false; rawLength: number }
  // | null` — vit dans `src/engine/core/jsonl.ts` ; elle est recopiée ici en
  // annotation locale plutôt qu'importée, pour ne pas faire dépendre ce
  // fichier de l'emplacement du moteur — seul le pont le sait.
  const verdict: { ok: true; value: unknown } | { ok: false; rawLength: number } | null = decodeJsonlLine(line);
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

const tokensSupported = true;

export {
  tokensSupported,
  discoverPath,
  parseUsageLine,
};

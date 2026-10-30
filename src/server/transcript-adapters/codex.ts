'use strict';
// Codex transcript adapter (rollout-*.jsonl).
//
// Une ligne `event_msg` / `token_count` porte le cumul de la session et le dernier appel.
// Le modèle est sur les lignes `turn_context`, pas sur la ligne de jetons.
// Un fil dérivé (`session_meta.forked_from_id`) copie l'historique de son parent sans marquer la fin
// de la copie : ses jetons sont déclarés non lisibles et il n'a pas de question. La question est
// l'item `UserMessage`. Un sous-agent a son propre transcript, dont le cumul part de zéro ; s'il
// hérite de l'historique, `subagent_history_start_ordinal` marque la fin de la copie.

import { ensureTokens, accumulateUsage, newBucket } from '../tokens.ts';
import { decodeJsonlLine } from '../../engine/core/jsonl.ts';
import type { RawUsage } from '../../engine/core/events.ts';
import type { UsageRecord } from './claude.ts';
import type { SubagentTranscript } from './types.ts';

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

// Les événements du hook lancés par un sous-agent portent son fil et son transcript propre. La fin
// d'un sous-agent, elle, est écrite avec le transcript du fil qui l'a lancé.
function subagentTranscript(evt: unknown): SubagentTranscript | null {
  if (!isRecord(evt) || evt.hook_event_name === 'SubagentStop') return null;
  const agentId = asString(evt.agent_id);
  const path = asString(evt.transcript_path);
  return agentId && path ? { agentId, path } : null;
}

function isForkedMeta(evt: Record<string, unknown>): boolean {
  return evt.type === 'session_meta' && isRecord(evt.payload) && !!asString(evt.payload.forked_from_id);
}

interface Counters {
  input: number;
  cached: number;
  cacheWrite: number;
  output: number;
  total: number;
}

function counters(v: unknown): Counters | null {
  if (!isRecord(v)) return null;
  const { input_tokens, cached_input_tokens, cache_write_input_tokens, output_tokens, total_tokens } = v;
  if (typeof input_tokens !== 'number' || typeof cached_input_tokens !== 'number'
    || typeof cache_write_input_tokens !== 'number' || typeof output_tokens !== 'number'
    || typeof total_tokens !== 'number') return null;
  return { input: input_tokens, cached: cached_input_tokens, cacheWrite: cache_write_input_tokens, output: output_tokens, total: total_tokens };
}

// Chez Codex le cache lu est inclus dans `input_tokens`, et la réflexion dans `output_tokens`.
function toRawUsage(call: Counters): RawUsage {
  return {
    input_tokens: call.input - call.cached,
    cache_read_input_tokens: call.cached,
    cache_creation_input_tokens: call.cacheWrite,
    output_tokens: call.output,
  };
}

interface CodexState {
  model: string | null;
  cumul: number;
  // Ordinal de la première ligne propre d'un sous-agent ; les lignes d'avant sont la copie du parent.
  historyStart: number;
  // Sous-agent dérivé sans fin de copie déclarée : aucune de ses lignes n'est comptée.
  unreadable: boolean;
}

const MAIN = '';

// L'état de lecture vit hors de l'enregistrement de session, que tous les lecteurs partagent :
// il disparaît avec lui. Un état par fil : chaque transcript a son propre cumul.
const states = new WeakMap<object, Map<string, CodexState>>();

function stateOf(tokens: object, thread: string): CodexState {
  let threads = states.get(tokens);
  if (!threads) {
    threads = new Map();
    states.set(tokens, threads);
  }
  let state = threads.get(thread);
  if (!state) {
    state = { model: null, cumul: 0, historyStart: 0, unreadable: false };
    threads.set(thread, state);
  }
  return state;
}

function bucketOf(tokens: NonNullable<UsageRecord['tokens']>, agentId: string | undefined): unknown {
  if (agentId === undefined) return tokens.main;
  let bucket = tokens.perAgent.get(agentId);
  if (bucket === undefined) {
    bucket = newBucket();
    tokens.perAgent.set(agentId, bucket);
  }
  return bucket;
}

// Un sous-agent qui hérite déclare où finit la copie ; un autre fil dérivé ne le dit pas. Un
// sous-agent illisible n'est pas compté, le fil de la session illisible rend la session illisible.
// Rend `false` quand c'est la session entière qui n'est pas lisible.
function readMeta(evt: Record<string, unknown>, state: CodexState, agentId: string | undefined): boolean {
  if (agentId === undefined) return !isForkedMeta(evt);
  const start = isRecord(evt.payload) ? evt.payload.subagent_history_start_ordinal : undefined;
  if (typeof start === 'number') state.historyStart = start;
  else if (isForkedMeta(evt)) {
    state.unreadable = true;
    console.error(`[codex] sous-agent ${agentId.slice(-8)} : fil dérivé sans fin de copie, ses jetons ne sont pas comptés`);
  }
  return true;
}

function parseUsageLine(line: string, rec: UsageRecord, agentId?: string): boolean {
  if (!line || (line.indexOf('"token_count"') === -1 && line.indexOf('"turn_context"') === -1
    && line.indexOf('"session_meta"') === -1)) return false;
  const verdict = decodeJsonlLine(line);
  if (!verdict || !verdict.ok) return false;
  const evt = verdict.value;
  if (!isRecord(evt) || !isRecord(evt.payload)) return false;

  ensureTokens(rec);
  const tokens = rec.tokens;
  if (!tokens) return false;
  if (tokens.unsupported) return false;
  const state = stateOf(tokens, agentId ?? MAIN);

  if (state.unreadable) return false;
  if (typeof evt.ordinal === 'number' && evt.ordinal < state.historyStart) return false;
  if (evt.type === 'session_meta') {
    if (readMeta(evt, state, agentId)) return false;
    tokens.unsupported = true;
    return true;
  }
  if (evt.type === 'turn_context') {
    const model = asString(evt.payload.model);
    if (model) state.model = model;
    return false;
  }
  if (evt.type !== 'event_msg' || evt.payload.type !== 'token_count' || !isRecord(evt.payload.info)) return false;
  const cumul = counters(evt.payload.info.total_token_usage);
  const call = counters(evt.payload.info.last_token_usage);
  if (!cumul || !call) return false;

  const delta = cumul.total - state.cumul;
  state.cumul = cumul.total;
  // Un appel réel fait avancer le cumul de sa propre taille. Un écart nul est une ligne
  // répétée ; un autre écart est un cumul hérité d'un fil parent, dont on ne sait rien.
  if (delta <= 0 || delta !== call.total) return false;
  // Un total qui contredit ses compteurs ne dit pas ce qu'il contient : la session n'est pas
  // lisible, un total à 0 passerait pour une mesure.
  if (call.input + call.output !== call.total) {
    tokens.unsupported = true;
    return true;
  }
  // Sans modèle le coût passerait pour complet à 0 $ : l'appel n'est pas compté.
  if (state.model === null) return false;

  // Le cumul ne baisse jamais et avance à chaque appel : il identifie l'appel, et une
  // relecture du fichier retombe sur le même identifiant.
  accumulateUsage(bucketOf(tokens, agentId), toRawUsage(call), state.model, `codex:${cumul.total}`, asString(evt.timestamp));
  return true;
}

// Avec un fichier joint, Codex Desktop écrit la liste des fichiers puis cette ligne : la question
// est ce qui la suit.
const REQUEST_HEADING = /^## My request:[ \t]*\r?$/m;

function questionOf(text: string): string {
  const heading = REQUEST_HEADING.exec(text);
  return (heading ? text.slice(heading.index + heading[0].length) : text).trim();
}

function userMessageText(item: unknown): string | null {
  if (!isRecord(item) || item.type !== 'UserMessage' || !Array.isArray(item.content)) return null;
  for (const block of item.content as unknown[]) {
    if (!isRecord(block) || block.type !== 'text' || typeof block.text !== 'string') continue;
    const text = questionOf(block.text);
    if (text) return text.slice(0, 120);
  }
  return null;
}

function extractPrompt(content: string): string | null {
  for (const line of content.split('\n')) {
    if (line.indexOf('"UserMessage"') === -1 && line.indexOf('"session_meta"') === -1) continue;
    const verdict = decodeJsonlLine(line);
    if (!verdict || !verdict.ok) continue;
    const o = verdict.value;
    if (!isRecord(o)) continue;
    // Le premier message d'un fil dérivé est une copie de celui de son parent.
    if (isForkedMeta(o)) return null;
    if (!isRecord(o.payload) || o.payload.type !== 'item_completed') continue;
    const text = userMessageText(o.payload.item);
    if (text !== null) return text;
  }
  return null;
}

const tokensSupported = true;
// Les jetons de Codex sont dans le transcript, lus ligne à ligne par `parseUsageLine`.
const usageSnapshot = null;

export {
  tokensSupported,
  discoverPath,
  subagentTranscript,
  extractPrompt,
  parseUsageLine,
  usageSnapshot,
};

'use strict';
// Codex transcript adapter (rollout-*.jsonl).
//
// Une ligne `event_msg` / `token_count` porte le cumul de la session et le dernier appel.
// Le modèle est sur les lignes `turn_context`, pas sur la ligne de jetons.
// Un fil dérivé (`session_meta.forked_from_id`) copie l'historique de son parent sans marquer la fin
// de la copie : ses jetons sont déclarés non lisibles. La question est l'item `UserMessage`.

import { ensureTokens, accumulateUsage } from '../tokens.ts';
import { decodeJsonlLine } from '../../engine/core/jsonl.ts';
import type { RawUsage } from '../../engine/core/events.ts';
import type { UsageRecord } from './claude.ts';

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
}

// L'état de lecture vit hors de l'enregistrement de session, que tous les lecteurs partagent :
// il disparaît avec lui.
const states = new WeakMap<object, CodexState>();

function stateOf(tokens: object): CodexState {
  let state = states.get(tokens);
  if (!state) {
    state = { model: null, cumul: 0 };
    states.set(tokens, state);
  }
  return state;
}

function parseUsageLine(line: string, rec: UsageRecord): boolean {
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
  const state = stateOf(tokens);

  if (evt.type === 'session_meta') {
    const parent = asString(evt.payload.forked_from_id);
    if (!parent) return false;
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
  // Un total qui contredit ses compteurs ajouterait 0 jeton et remettrait la taille de contexte à 0.
  if (call.input + call.output !== call.total) return false;
  // Sans modèle le coût passerait pour complet à 0 $ : la ligne attend son `turn_context`.
  if (state.model === null) return false;

  // Le cumul ne baisse jamais et avance à chaque appel : il identifie l'appel, et une
  // relecture du fichier retombe sur le même identifiant.
  accumulateUsage(tokens.main, toRawUsage(call), state.model, `codex:${cumul.total}`, asString(evt.timestamp));
  return true;
}

function userMessageText(item: unknown): string | null {
  if (!isRecord(item) || item.type !== 'UserMessage' || !Array.isArray(item.content)) return null;
  for (const block of item.content as unknown[]) {
    if (!isRecord(block) || block.type !== 'text' || typeof block.text !== 'string') continue;
    const text = block.text.trim();
    if (text) return text.slice(0, 120);
  }
  return null;
}

function extractPrompt(content: string): string | null {
  for (const line of content.split('\n')) {
    if (line.indexOf('"UserMessage"') === -1) continue;
    const verdict = decodeJsonlLine(line);
    if (!verdict || !verdict.ok) continue;
    const o = verdict.value;
    if (!isRecord(o) || !isRecord(o.payload) || o.payload.type !== 'item_completed') continue;
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
  extractPrompt,
  parseUsageLine,
  usageSnapshot,
};

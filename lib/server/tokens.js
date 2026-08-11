'use strict';
// Per-session token tracking — buckets, accumulation, debounced broadcast.
//
// Each session accumulates token usage from its transcript (main thread +
// per-subagent). The transcript is the single source of truth — every
// assistant message and every agent_progress event flows through here.
//
// Bucket shape:
//   { in, out, cacheCreate, cacheRead } — cumulative sums (for detailed popup).
//   { lastIn, lastCacheCreate, lastCacheRead } — most recent message's usage
//     values (not summed). The sum of these three = current context window size
//     (matches Claude Code's /context output).
//   { lastModel, contextMax, costUsd } — pricing-derived: most recent model id
//     reported in transcripts, its context window size, and the cumulative
//     cost in USD computed at parse time (per-message, using the model that
//     produced that message — robust to mid-session model switches).

const { broadcastSSE } = require('./sse');
const { getPrice, computeCost, normalizeId } = require('./pricing');
const { addUsage, emptyUsageBucket, finiteCount, isDedupableMsgId } = require('./usage');

function newBucket() {
  return {
    // C3 : les six champs bruts viennent de la primitive du moteur. Le seau en
    // gagne DEUX au passage — `cacheCreate1h` et `cacheCreate5m`, la ventilation
    // par fenêtre de cache que seul le moteur suivait. L'enveloppe SSE est
    // additive : un navigateur qui ne les connaît pas les ignore.
    ...emptyUsageBucket(),
    lastIn: 0, lastCacheCreate: 0, lastCacheRead: 0,
    lastModel: null, contextMax: 0, costUsd: 0,
    // Set of Anthropic message ids already accumulated. Claude Code writes one
    // JSONL line per content block (thinking, text, tool_use) but every line
    // carries the same `usage` — without dedup the bucket sums it N times.
    // JSON.stringify serializes a Set to `{}`, so this stays invisible in the
    // SSE snapshot envelope.
    _seenMsgIds: new Set(),
  };
}

function ensureTokens(rec) {
  if (!rec.tokens) {
    rec.tokens = {
      main: newBucket(),
      perAgent: new Map(),
      _broadcastTimer: null,
    };
  }
}

function tokenSum(b) {
  if (!b) return 0;
  return (b.in || 0) + (b.out || 0) + (b.cacheCreate || 0) + (b.cacheRead || 0);
}

function accumulateUsage(bucket, usage, model, msgId, at) {
  // Idempotence by Anthropic message id — see _seenMsgIds note in newBucket.
  // Opt-in: callers without a stable id (e.g. legacy hooks) keep cumulating
  // as before.
  // C3 : la règle de déduplication vient de la primitive commune — un
  // identifiant vide n'est pas un identifiant.
  if (isDedupableMsgId(msgId)) {
    if (bucket._seenMsgIds.has(msgId)) return;
    bucket._seenMsgIds.add(msgId);
  }
  // C3 : l'accumulation des six champs bruts, une seule définition.
  addUsage(bucket, usage);
  // Track the most recent message's values. Transcript/hook events are parsed
  // in chronological order, so "last wins" gives the current context size.
  // Même garde que la primitive : sans elle, un message malformé donnerait
  // `in: 0` mais `lastIn: "100"` — une incohérence à l'intérieur d'un seul seau.
  bucket.lastIn = finiteCount(usage.input_tokens);
  bucket.lastCacheCreate = finiteCount(usage.cache_creation_input_tokens);
  bucket.lastCacheRead = finiteCount(usage.cache_read_input_tokens);
  // Pricing-derived fields: only updated when we know the model. Cost
  // accumulates per-message so a session that switches models mid-flight
  // (e.g. main=Opus, subagent fork=Haiku) still totals correctly.
  // The price is resolved once and reused for computeCost — avoids a second
  // hash lookup + regex chain on this hot path. lastModel stores the
  // canonical id (no provider prefix) so the UI shows a clean label
  // regardless of whether the transcript reported claude-opus-4-7 or
  // bedrock/anthropic.claude-opus-4-7-v1:0. `at` (message timestamp) selects
  // the tariff in effect when the message was produced (rate changes exist —
  // e.g. sonnet-5 intro pricing until 2026-08-31).
  if (model) {
    const price = getPrice(model, at);
    if (price) {
      bucket.lastModel = normalizeId(model);
      bucket.contextMax = price.maxInput;
      bucket.costUsd += computeCost(usage, price);
    }
  }
}

function tokensSnapshot(rec) {
  if (!rec.tokens) return null;
  const perAgent = {};
  for (const [aid, bucket] of rec.tokens.perAgent) perAgent[aid] = bucket;
  return {
    main: rec.tokens.main,
    perAgent,
    tokensSupported: !rec.tokens.unsupported,
    // Claude session whose transcript file hasn't been located yet — lets the
    // UI show an explicit state instead of a blank pill. Always false once
    // discovery succeeds, and meaningless when tokensSupported is false.
    transcriptMissing: !!rec.tokens.transcriptMissing,
  };
}

// Build the SSE `tokens` message for a session, or null if it has no token
// state yet. Single source of truth for the wire shape — used both by the
// live broadcast and by the replay sent to freshly-connected SSE clients.
function tokensMessage(sid, rec) {
  const snap = tokensSnapshot(rec);
  if (!snap) return null;
  return { type: 'tokens', session: sid, ...snap };
}

function broadcastTokens(sid, rec) {
  const msg = tokensMessage(sid, rec);
  if (msg) broadcastSSE(msg);
}

function scheduleTokensBroadcast(sid, rec) {
  ensureTokens(rec);
  if (rec.tokens._broadcastTimer) return;
  rec.tokens._broadcastTimer = setTimeout(() => {
    rec.tokens._broadcastTimer = null;
    broadcastTokens(sid, rec);
  }, 250);
}

// Cancel any pending broadcast timer on this rec — used by deleteSession.
function clearTokensTimer(rec) {
  if (rec.tokens && rec.tokens._broadcastTimer) {
    clearTimeout(rec.tokens._broadcastTimer);
    rec.tokens._broadcastTimer = null;
  }
}

module.exports = {
  newBucket, ensureTokens, tokenSum, accumulateUsage,
  tokensSnapshot, tokensMessage, broadcastTokens, scheduleTokensBroadcast,
  clearTokensTimer,
};

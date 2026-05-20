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

function newBucket() {
  return {
    in: 0, out: 0, cacheCreate: 0, cacheRead: 0,
    lastIn: 0, lastCacheCreate: 0, lastCacheRead: 0,
    lastModel: null, contextMax: 0, costUsd: 0,
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

function accumulateUsage(bucket, usage, model) {
  bucket.in += usage.input_tokens || 0;
  bucket.out += usage.output_tokens || 0;
  bucket.cacheCreate += usage.cache_creation_input_tokens || 0;
  bucket.cacheRead += usage.cache_read_input_tokens || 0;
  // Track the most recent message's values. Transcript/hook events are parsed
  // in chronological order, so "last wins" gives the current context size.
  bucket.lastIn = usage.input_tokens || 0;
  bucket.lastCacheCreate = usage.cache_creation_input_tokens || 0;
  bucket.lastCacheRead = usage.cache_read_input_tokens || 0;
  // Pricing-derived fields: only updated when we know the model. Cost
  // accumulates per-message so a session that switches models mid-flight
  // (e.g. main=Opus, subagent fork=Haiku) still totals correctly.
  // The price is resolved once and reused for computeCost — avoids a second
  // hash lookup + regex chain on this hot path. lastModel stores the
  // canonical id (no provider prefix) so the UI shows a clean label
  // regardless of whether the transcript reported claude-opus-4-7 or
  // bedrock/anthropic.claude-opus-4-7-v1:0.
  if (model) {
    const price = getPrice(model);
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

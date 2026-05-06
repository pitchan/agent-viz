'use strict';
// Per-session token tracking — buckets, accumulation, debounced broadcast.
//
// Each session accumulates token usage from its transcript (main thread +
// per-subagent). `PostToolUse(Agent)` hook events provide a fallback when the
// transcript has no data for that agent id yet.
//
// Bucket shape:
//   { in, out, cacheCreate, cacheRead } — cumulative sums (for detailed popup).
//   { lastIn, lastCacheCreate, lastCacheRead } — most recent message's usage
//     values (not summed). The sum of these three = current context window size
//     (matches Claude Code's /context output).

const { broadcastSSE } = require('./sse');

function newBucket() {
  return { in:0, out:0, cacheCreate:0, cacheRead:0, lastIn:0, lastCacheCreate:0, lastCacheRead:0 };
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

function accumulateUsage(bucket, usage) {
  bucket.in += usage.input_tokens || 0;
  bucket.out += usage.output_tokens || 0;
  bucket.cacheCreate += usage.cache_creation_input_tokens || 0;
  bucket.cacheRead += usage.cache_read_input_tokens || 0;
  // Track the most recent message's values. Transcript/hook events are parsed
  // in chronological order, so "last wins" gives the current context size.
  bucket.lastIn = usage.input_tokens || 0;
  bucket.lastCacheCreate = usage.cache_creation_input_tokens || 0;
  bucket.lastCacheRead = usage.cache_read_input_tokens || 0;
}

// Record usage for a specific agent id under a session record. Returns true
// if the agent's bucket was empty before (i.e. this is the first datapoint —
// useful for the PostToolUse(Agent) fallback path which only writes when no
// transcript data has landed yet). Used by both the transcript reader and the
// hook fallback in event-reader.
function recordAgentUsage(rec, aid, usage, { onlyIfEmpty = false } = {}) {
  ensureTokens(rec);
  const existing = rec.tokens.perAgent.get(aid);
  const isEmpty = !existing || tokenSum(existing) === 0;
  if (onlyIfEmpty && !isEmpty) return false;
  const bucket = existing || newBucket();
  accumulateUsage(bucket, usage);
  rec.tokens.perAgent.set(aid, bucket);
  return isEmpty;
}

function tokensSnapshot(rec) {
  if (!rec.tokens) return null;
  const perAgent = {};
  for (const [aid, bucket] of rec.tokens.perAgent) perAgent[aid] = bucket;
  return { main: rec.tokens.main, perAgent };
}

function broadcastTokens(sid, rec) {
  const snap = tokensSnapshot(rec);
  if (!snap) return;
  broadcastSSE({ type: 'tokens', session: sid, main: snap.main, perAgent: snap.perAgent });
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
  recordAgentUsage,
  tokensSnapshot, broadcastTokens, scheduleTokensBroadcast,
  clearTokensTimer,
};

'use strict';
// Smoke test for the cumulative + last-wins logic in lib/server/tokens.js.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { newBucket, accumulateUsage } = require('../../lib/server/tokens');

test('accumulateUsage cumulates totals AND tracks the last message values', () => {
  const b = newBucket();

  accumulateUsage(b, {
    input_tokens: 100,
    output_tokens: 50,
    cache_creation_input_tokens: 200,
    cache_read_input_tokens: 1000,
  });
  accumulateUsage(b, {
    input_tokens: 30,
    output_tokens: 10,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 1500,
  });

  // Cumulative buckets sum across all messages — used for total/cost displays.
  assert.equal(b.in, 130);
  assert.equal(b.out, 60);
  assert.equal(b.cacheCreate, 200);
  assert.equal(b.cacheRead, 2500);

  // Last-message values overwrite (last-wins) — sum of the three approximates
  // the current context window size, matching Claude Code's /context output.
  assert.equal(b.lastIn, 30);
  assert.equal(b.lastCacheCreate, 0);
  assert.equal(b.lastCacheRead, 1500);
});

test('newBucket exposes pricing fields zeroed out', () => {
  const b = newBucket();
  assert.equal(b.lastModel, null);
  assert.equal(b.contextMax, 0);
  assert.equal(b.costUsd, 0);
});

test('accumulateUsage without a model leaves pricing fields untouched', () => {
  const b = newBucket();
  accumulateUsage(b, { input_tokens: 100, output_tokens: 50 });
  assert.equal(b.lastModel, null);
  assert.equal(b.contextMax, 0);
  assert.equal(b.costUsd, 0);
});

test('accumulateUsage with a known model populates lastModel/contextMax and accumulates costUsd', () => {
  const b = newBucket();
  // claude-sonnet-4-5 is in the static FALLBACK — no network needed.
  accumulateUsage(b, {
    input_tokens: 1_000,
    output_tokens: 500,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  }, 'claude-sonnet-4-5');
  assert.equal(b.lastModel, 'claude-sonnet-4-5');
  assert.ok(b.contextMax > 0, 'contextMax should be set from the model');
  // 1000 * 3e-6 + 500 * 1.5e-5 = 0.003 + 0.0075 = 0.0105
  assert.ok(Math.abs(b.costUsd - 0.0105) < 1e-9, `got ${b.costUsd}`);

  accumulateUsage(b, {
    input_tokens: 200, output_tokens: 100,
    cache_creation_input_tokens: 0, cache_read_input_tokens: 0,
  }, 'claude-sonnet-4-5');
  // costUsd accumulates: previous 0.0105 + 200*3e-6 + 100*1.5e-5 = 0.0105 + 0.0006 + 0.0015 = 0.0126
  assert.ok(Math.abs(b.costUsd - 0.0126) < 1e-9, `got ${b.costUsd}`);
});

test('accumulateUsage stores the canonical id (normalized) regardless of input transport', () => {
  // Bedrock/Vertex/dated suffixes must not leak into the bucket — the UI
  // uses lastModel to derive a clean label and shouldn't have to handle
  // every transport variant.
  const cases = [
    'anthropic.claude-sonnet-4-5-v1:0',
    'bedrock/claude-sonnet-4-5',
    'claude-sonnet-4-5-20250929',
  ];
  for (const raw of cases) {
    const b = newBucket();
    accumulateUsage(b, { input_tokens: 100, output_tokens: 50 }, raw);
    assert.equal(b.lastModel, 'claude-sonnet-4-5', `failed for ${raw}`);
  }
});

test('accumulateUsage with an unknown model leaves pricing fields untouched', () => {
  const b = newBucket();
  accumulateUsage(b, { input_tokens: 1000, output_tokens: 500 }, 'claude-mythical-99-99');
  // Token counters still update, but pricing stays at zero — better than
  // crashing or filling with NaN when a future model arrives before the
  // pricing fetch resolves.
  assert.equal(b.in, 1000);
  assert.equal(b.lastModel, null);
  assert.equal(b.costUsd, 0);
});

test('tokensSnapshot exposes tokensSupported flag (default true)', () => {
  const { ensureTokens, tokensSnapshot } = require('../../lib/server/tokens');
  const rec = { id: 'r1' };
  ensureTokens(rec);
  const snap = tokensSnapshot(rec);
  assert.equal(snap.tokensSupported, true);
});

test('tokensSnapshot reports tokensSupported=false when rec.tokens.unsupported is set', () => {
  const { ensureTokens, tokensSnapshot } = require('../../lib/server/tokens');
  const rec = { id: 'r2' };
  ensureTokens(rec);
  rec.tokens.unsupported = true;
  const snap = tokensSnapshot(rec);
  assert.equal(snap.tokensSupported, false);
});

// Claude Code splits one API message into N JSONL lines (one per content
// block: thinking, text, tool_use) but every line carries the SAME `usage`.
// Without dedup the bucket sums it N times — causing 2-3× cost over-reporting.
// The msgId (message.id from the Anthropic API) is the natural dedup key.
test('accumulateUsage with the same msgId is a no-op (dedup across content blocks)', () => {
  const b = newBucket();
  const usage = {
    input_tokens: 100, output_tokens: 50,
    cache_creation_input_tokens: 200, cache_read_input_tokens: 1000,
  };
  // Three lines for the same API message — thinking + text + tool_use.
  accumulateUsage(b, usage, 'claude-sonnet-4-5', 'msg_01ABC');
  accumulateUsage(b, usage, 'claude-sonnet-4-5', 'msg_01ABC');
  accumulateUsage(b, usage, 'claude-sonnet-4-5', 'msg_01ABC');
  assert.equal(b.in, 100, 'input must not be triple-counted');
  assert.equal(b.out, 50);
  assert.equal(b.cacheCreate, 200);
  assert.equal(b.cacheRead, 1000);
  // Cost similarly counted exactly once.
  // 100*3e-6 + 50*1.5e-5 + 200*3.75e-6 + 1000*3e-7 = 0.0003 + 0.00075 + 0.00075 + 0.0003 = 0.00210
  assert.ok(Math.abs(b.costUsd - 0.0021) < 1e-9, `got ${b.costUsd}`);
});

test('accumulateUsage without msgId keeps cumulating (back-compat for callers that have no id)', () => {
  // Some legacy/hook code paths may not carry a msgId. They must keep working
  // as before — dedup is opt-in via the 4th argument.
  const b = newBucket();
  accumulateUsage(b, { input_tokens: 10, output_tokens: 5 });
  accumulateUsage(b, { input_tokens: 10, output_tokens: 5 });
  assert.equal(b.in, 20);
  assert.equal(b.out, 10);
});

test('accumulateUsage with different msgIds cumulates normally', () => {
  const b = newBucket();
  accumulateUsage(b, { input_tokens: 10, output_tokens: 5 }, 'claude-sonnet-4-5', 'msg_A');
  accumulateUsage(b, { input_tokens: 20, output_tokens: 10 }, 'claude-sonnet-4-5', 'msg_B');
  assert.equal(b.in, 30);
  assert.equal(b.out, 15);
});

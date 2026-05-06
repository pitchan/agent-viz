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

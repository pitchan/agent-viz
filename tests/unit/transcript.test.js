'use strict';
// parseTranscriptEvent — bridge between raw transcript JSONL lines and the
// per-bucket token accumulation. Verifies that:
//   - the model field travels from `evt.message.model` (main thread) and
//     `evt.data.message.message.model` (subagent stream) into the bucket
//   - non-token-bearing lines are correctly ignored (return false)
//   - the inline subagent bucket creation uses the full newBucket() shape so
//     pricing fields (costUsd, lastModel, contextMax) don't end up undefined

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { _internals } = require('../../lib/server/transcript');
const { ensureTokens } = require('../../lib/server/tokens');

const { parseTranscriptEvent } = _internals;

function freshRec() {
  const rec = { id: 'test-sess', tokens: null };
  ensureTokens(rec);
  return rec;
}

test('main-thread assistant line populates main bucket with model + cost', () => {
  const rec = freshRec();
  const line = JSON.stringify({
    type: 'assistant',
    isSidechain: false,
    message: {
      model: 'claude-sonnet-4-5',
      usage: {
        input_tokens: 1000, output_tokens: 500,
        cache_creation_input_tokens: 0, cache_read_input_tokens: 0,
      },
    },
  });
  const changed = parseTranscriptEvent(line, rec);
  assert.equal(changed, true);
  assert.equal(rec.tokens.main.in, 1000);
  assert.equal(rec.tokens.main.lastModel, 'claude-sonnet-4-5');
  assert.ok(rec.tokens.main.contextMax > 0, 'contextMax must be set from pricing');
  // Sonnet 4.5: 1000*3e-6 + 500*1.5e-5 = 0.003 + 0.0075 = 0.0105
  assert.ok(Math.abs(rec.tokens.main.costUsd - 0.0105) < 1e-9, `got ${rec.tokens.main.costUsd}`);
});

test('subagent agent_progress line populates perAgent bucket with model + cost', () => {
  const rec = freshRec();
  const line = JSON.stringify({
    type: 'progress',
    data: {
      type: 'agent_progress',
      agentId: 'agent-xyz',
      message: {
        message: {
          model: 'claude-haiku-4-5',
          usage: {
            input_tokens: 2000, output_tokens: 100,
            cache_creation_input_tokens: 0, cache_read_input_tokens: 0,
          },
        },
      },
    },
  });
  const changed = parseTranscriptEvent(line, rec);
  assert.equal(changed, true);
  const bucket = rec.tokens.perAgent.get('agent-xyz');
  assert.ok(bucket, 'agent bucket should be created');
  assert.equal(bucket.in, 2000);
  assert.equal(bucket.lastModel, 'claude-haiku-4-5');
  // Verify the subagent bucket got the FULL newBucket shape — historically a
  // partial inline literal here meant pricing fields were undefined and
  // costUsd += ... would return NaN.
  assert.equal(typeof bucket.costUsd, 'number');
  assert.ok(!Number.isNaN(bucket.costUsd));
  // Haiku: 2000*1e-6 + 100*5e-6 = 0.002 + 0.0005 = 0.0025
  assert.ok(Math.abs(bucket.costUsd - 0.0025) < 1e-9, `got ${bucket.costUsd}`);
});

test('subagent transcript-file line (isSidechain + agentId) populates perAgent bucket', () => {
  // Claude Code ≥ ~2.1.143 writes each sub-agent's transcript to its own file
  // (<session>/subagents/agent-<id>.jsonl). Those assistant lines carry
  // isSidechain:true plus a top-level agentId, with the same message.usage
  // shape as the main thread.
  const rec = freshRec();
  const line = JSON.stringify({
    type: 'assistant',
    isSidechain: true,
    agentId: 'a0b3d9c1c934d0613',
    message: {
      model: 'claude-haiku-4-5',
      usage: {
        input_tokens: 3, output_tokens: 1,
        cache_creation_input_tokens: 3364, cache_read_input_tokens: 28466,
      },
    },
  });
  const changed = parseTranscriptEvent(line, rec);
  assert.equal(changed, true);
  const bucket = rec.tokens.perAgent.get('a0b3d9c1c934d0613');
  assert.ok(bucket, 'subagent bucket should be created');
  assert.equal(bucket.in, 3);
  assert.equal(bucket.cacheCreate, 3364);
  assert.equal(bucket.cacheRead, 28466);
  assert.equal(bucket.lastModel, 'claude-haiku-4-5');
  assert.ok(bucket.contextMax > 0, 'contextMax must be set from pricing');
  assert.equal(rec.tokens.main.in, 0, 'main bucket must stay untouched');
});

test('sidechain assistant line without agentId is ignored (no miscrediting)', () => {
  // A sidechain line that lacks a top-level agentId can't be attributed to a
  // sub-agent bucket — it must be skipped rather than land in __main__.
  const rec = freshRec();
  const line = JSON.stringify({
    type: 'assistant', isSidechain: true,
    message: { model: 'claude-haiku-4-5', usage: { input_tokens: 100, output_tokens: 50 } },
  });
  assert.equal(parseTranscriptEvent(line, rec), false);
  assert.equal(rec.tokens.main.in, 0);
  assert.equal(rec.tokens.perAgent.size, 0);
});

test('lines without usage payload return false and do not touch buckets', () => {
  const rec = freshRec();
  const lines = [
    JSON.stringify({ type: 'assistant', isSidechain: false, message: { model: 'claude-sonnet-4-5' } }),
    JSON.stringify({ type: 'user', isSidechain: false, message: { content: 'hi' } }),
    JSON.stringify({ type: 'progress', data: { type: 'something_else' } }),
    'not even json',
  ];
  for (const line of lines) {
    assert.equal(parseTranscriptEvent(line, rec), false, `line should be ignored: ${line.slice(0, 40)}`);
  }
  assert.equal(rec.tokens.main.in, 0);
  assert.equal(rec.tokens.main.costUsd, 0);
  assert.equal(rec.tokens.perAgent.size, 0);
});

test('main-thread line without model still records tokens but no cost', () => {
  // Defensive: older transcript schemas may omit `model`. Tokens should still
  // accumulate (the user wants to see them) but cost stays at 0.
  const rec = freshRec();
  const line = JSON.stringify({
    type: 'assistant',
    isSidechain: false,
    message: {
      usage: { input_tokens: 500, output_tokens: 200 },
    },
  });
  assert.equal(parseTranscriptEvent(line, rec), true);
  assert.equal(rec.tokens.main.in, 500);
  assert.equal(rec.tokens.main.lastModel, null);
  assert.equal(rec.tokens.main.costUsd, 0);
});

test('parseTranscriptEvent short-circuits when line lacks "usage" substring', () => {
  // Cheap pre-filter avoids a JSON.parse on every system event / user message
  // / tool result line in a multi-MB transcript. Verify it really skips and
  // doesn't false-negative on a usage-bearing line.
  const rec = freshRec();
  // No "usage" substring → must short-circuit. Doesn't matter that it's valid JSON.
  assert.equal(parseTranscriptEvent('{"type":"user","content":"hi"}', rec), false);
  // Empty / null / non-string → must not throw.
  assert.equal(parseTranscriptEvent('', rec), false);
  assert.equal(parseTranscriptEvent(null, rec), false);
  // The substring must trigger the parse path.
  const line = JSON.stringify({
    type: 'assistant', isSidechain: false,
    message: { model: 'claude-sonnet-4-5', usage: { input_tokens: 1, output_tokens: 1 } },
  });
  assert.equal(parseTranscriptEvent(line, rec), true);
});

test('two messages on the same agent accumulate cost and overwrite lastModel', () => {
  const rec = freshRec();
  const lineA = JSON.stringify({
    type: 'progress',
    data: {
      type: 'agent_progress',
      agentId: 'a-1',
      message: { message: {
        model: 'claude-haiku-4-5',
        usage: { input_tokens: 1000, output_tokens: 0 },
      } },
    },
  });
  const lineB = JSON.stringify({
    type: 'progress',
    data: {
      type: 'agent_progress',
      agentId: 'a-1',
      message: { message: {
        model: 'claude-sonnet-4-5',
        usage: { input_tokens: 1000, output_tokens: 0 },
      } },
    },
  });
  parseTranscriptEvent(lineA, rec);
  parseTranscriptEvent(lineB, rec);
  const bucket = rec.tokens.perAgent.get('a-1');
  // Cumulative tokens
  assert.equal(bucket.in, 2000);
  // lastModel = the most recent one (last-wins, like the lastIn fields)
  assert.equal(bucket.lastModel, 'claude-sonnet-4-5');
  // Cost summed across both rates: 1000*1e-6 (haiku) + 1000*3e-6 (sonnet) = 0.001 + 0.003 = 0.004
  assert.ok(Math.abs(bucket.costUsd - 0.004) < 1e-9, `got ${bucket.costUsd}`);
});

test('parseTranscriptEvent dispatches via rec.agentSource — copilot is no-op', () => {
  // Claude-shaped line with usage on a Copilot-tagged session must NOT
  // accumulate, because the Copilot adapter is the no-op. This proves the
  // dispatcher actually consults agentSource instead of always running Claude.
  const rec = freshRec();
  rec.agentSource = 'copilot';
  const line = JSON.stringify({
    type: 'assistant',
    isSidechain: false,
    message: {
      model: 'claude-sonnet-4-5',
      usage: { input_tokens: 9999, output_tokens: 9999 },
    },
  });
  assert.equal(parseTranscriptEvent(line, rec), false);
  assert.equal(rec.tokens.main.in, 0);
  assert.equal(rec.tokens.main.costUsd, 0);
});

test('parseTranscriptEvent with agentSource=undefined still parses as Claude', () => {
  // Pre-0.2.0 sessions: agentSource missing. Must keep working.
  const rec = freshRec();
  // rec.agentSource stays undefined
  const line = JSON.stringify({
    type: 'assistant', isSidechain: false,
    message: { model: 'claude-sonnet-4-5', usage: { input_tokens: 100, output_tokens: 50 } },
  });
  assert.equal(parseTranscriptEvent(line, rec), true);
  assert.equal(rec.tokens.main.in, 100);
});

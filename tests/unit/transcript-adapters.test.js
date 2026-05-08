'use strict';
// Contract tests for the transcript-adapter registry.
//
// Liskov is enforced here, not by inheritance: every adapter must expose the
// same field set with the same types. If a future adapter (Cursor, Aider...)
// ships with a missing field or wrong type, this test fails before the
// dispatcher silently falls back.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { TRANSCRIPT_ADAPTERS, getAdapter } = require('../../lib/server/transcript-adapters');

const REQUIRED_FIELDS = {
  tokensSupported: 'boolean',
  discoverPath: 'function',
  parseUsageLine: 'function',
};

test('every adapter honors the same contract (Liskov)', () => {
  const names = Object.keys(TRANSCRIPT_ADAPTERS);
  assert.ok(names.length >= 2, 'expected at least claude + copilot adapters');
  for (const name of names) {
    const adapter = TRANSCRIPT_ADAPTERS[name];
    for (const [field, expectedType] of Object.entries(REQUIRED_FIELDS)) {
      assert.equal(
        typeof adapter[field], expectedType,
        `${name}.${field} must be a ${expectedType}`,
      );
    }
  }
});

test('getAdapter: null/undefined defaults to claude (pre-0.2.0 sessions)', () => {
  // Pre-0.2.0 hooks did not stamp _source. Those sessions must keep working
  // as Claude — the historical default at the time the data was produced.
  assert.equal(getAdapter(undefined), TRANSCRIPT_ADAPTERS.claude);
  assert.equal(getAdapter(null), TRANSCRIPT_ADAPTERS.claude);
  assert.equal(getAdapter('claude'), TRANSCRIPT_ADAPTERS.claude);
  assert.equal(getAdapter('copilot'), TRANSCRIPT_ADAPTERS.copilot);
});

test('getAdapter: unknown string logs an error and returns claude (loud fallback)', () => {
  // An unrecognised agentSource means a new producer was added at the hook
  // layer without a matching adapter. The system stays up (transcript
  // pipeline keeps running for known sources) but stderr surfaces the bug.
  const captured = [];
  const original = console.error;
  console.error = (...args) => captured.push(args.join(' '));
  try {
    const adapter = getAdapter('something-new');
    assert.equal(adapter, TRANSCRIPT_ADAPTERS.claude);
    assert.equal(captured.length, 1, 'expected exactly one console.error call');
    assert.match(captured[0], /unknown agentSource "something-new"/);
  } finally {
    console.error = original;
  }
});

test('copilot adapter declares tokens unsupported and parseUsageLine is a no-op', () => {
  const a = TRANSCRIPT_ADAPTERS.copilot;
  assert.equal(a.tokensSupported, false);
  // No-ops must return falsy without throwing on any input — the dispatcher
  // calls them on every transcript line of every Copilot session.
  assert.equal(a.discoverPath({ session_id: 'x' }), null);
  assert.equal(a.parseUsageLine('any line', { tokens: null }), false);
  assert.equal(a.parseUsageLine('', {}), false);
});


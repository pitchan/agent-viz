'use strict';
// Contract tests for the transcript-adapter registry.
//
// Liskov is enforced here, not by inheritance: every adapter must expose the
// same field set with the same types. If a future adapter (Cursor, Aider...)
// ships with a missing field or wrong type, this test fails before the
// dispatcher silently falls back.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { TRANSCRIPT_ADAPTERS, getAdapter } = require('../../src/server/transcript-adapters');
const { ensureTokens } = require('../../src/server/tokens');

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

// TEST AJOUTÉ, daté — C2, 2026-08-11.
//
// Ce fichier ne vérifiait que le contrat du registre : avant la migration, une
// mutation qui détruisait entièrement une des trois formes reconnues par
// l'adaptateur claude le laissait VERT (vérifié par exécution ; ce sont
// `transcript.test.js` et `transcript-subagents.test.js` qui virent au rouge).
// Le seul changement de comportement apporté par C2 sur ce site n'était donc
// épinglé nulle part : il l'est ici.
//
// Pourquoi il compte plus qu'ailleurs : ce site décode la QUEUE du transcript
// en direct, ligne par ligne, au fil de l'écriture. Une ligne perdue ici n'est
// rattrapée par aucune relecture ultérieure, contrairement aux deux sites déjà
// migrés. Arbitrage retenu, le même que partout : tolérer le BOM, comme le
// moteur le fait déjà.
test('C2 — une ligne d’usage préfixée d’un BOM est désormais comptabilisée', () => {
  const BOM = String.fromCharCode(0xFEFF);
  const ligne = JSON.stringify({
    type: 'assistant', isSidechain: false,
    message: {
      id: 'msg_bom', model: 'claude-sonnet-4-5',
      usage: { input_tokens: 123, output_tokens: 45 },
    },
  });
  const rec = { id: 'sess-bom', tokens: null };
  ensureTokens(rec);

  assert.equal(TRANSCRIPT_ADAPTERS.claude.parseUsageLine(BOM + ligne, rec), true,
    'le décodage passe par la primitive commune, qui tolère le BOM');
  // Assertion discriminante : on nomme les jetons attendus, pas seulement le
  // booléen — un `true` sans comptabilisation serait une régression muette.
  assert.equal(rec.tokens.main.in, 123);
  assert.equal(rec.tokens.main.out, 45);
  assert.equal(rec.tokens.main.lastModel, 'claude-sonnet-4-5');
});


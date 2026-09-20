// Contract tests for the transcript-adapter registry.
//
// Liskov is enforced here, not by inheritance: every adapter must expose the
// same field set with the same types. If a future adapter (Cursor, Aider...)
// ships with a missing field or wrong type, this test fails before the
// dispatcher silently falls back.

import { expect, test } from 'vitest';
import { TRANSCRIPT_ADAPTERS, getAdapter } from '../../src/server/transcript-adapters/index.ts';
import { ensureTokens } from '../../src/server/tokens.ts';

const REQUIRED_FIELDS = {
  tokensSupported: 'boolean',
  discoverPath: 'function',
  parseUsageLine: 'function',
};

test('every adapter honors the same contract (Liskov)', () => {
  const names = Object.keys(TRANSCRIPT_ADAPTERS);
  expect(names.length >= 2, 'expected at least claude + copilot adapters').toBeTruthy();
  for (const name of names) {
    const adapter = TRANSCRIPT_ADAPTERS[name as keyof typeof TRANSCRIPT_ADAPTERS] as Record<string, unknown>;
    for (const [field, expectedType] of Object.entries(REQUIRED_FIELDS)) {
      expect(typeof adapter[field], `${name}.${field} must be a ${expectedType}`).toBe(expectedType);
    }
  }
});

test('getAdapter: null/undefined defaults to claude (sessions without _source)', () => {
  // A hook command installed without --source stamps no _source: those sessions
  // are still on disk and must keep reading as Claude.
  expect(getAdapter(undefined)).toBe(TRANSCRIPT_ADAPTERS.claude);
  expect(getAdapter(null)).toBe(TRANSCRIPT_ADAPTERS.claude);
  expect(getAdapter('claude')).toBe(TRANSCRIPT_ADAPTERS.claude);
  expect(getAdapter('copilot')).toBe(TRANSCRIPT_ADAPTERS.copilot);
});

test('getAdapter: unknown string logs an error and returns claude (loud fallback)', () => {
  // An unrecognised agentSource means a new producer was added at the hook
  // layer without a matching adapter. The system stays up (transcript
  // pipeline keeps running for known sources) but stderr surfaces the bug.
  const captured: string[] = [];
  const original = console.error;
  console.error = (...args) => captured.push(args.join(' '));
  try {
    const adapter = getAdapter('something-new');
    expect(adapter).toBe(TRANSCRIPT_ADAPTERS.claude);
    expect(captured.length, 'expected exactly one console.error call').toBe(1);
    expect(captured[0]).toMatch(/unknown agentSource "something-new"/);
  } finally {
    console.error = original;
  }
});

test('copilot adapter declares tokens unsupported and parseUsageLine is a no-op', () => {
  const a = TRANSCRIPT_ADAPTERS.copilot;
  expect(a.tokensSupported).toBe(false);
  // No-ops must return falsy without throwing on any input — the dispatcher
  // calls them on every transcript line of every Copilot session.
  expect(a.discoverPath({ session_id: 'x' })).toBe(null);
  expect(a.parseUsageLine('any line', { tokens: null } as any)).toBe(false);
  expect(a.parseUsageLine('', {})).toBe(false);
});

// Ce site décode la QUEUE du transcript en direct, ligne par ligne, au fil de
// l'écriture : une ligne perdue ici n'est rattrapée par aucune relecture. Il
// tolère le BOM, comme le moteur.
//
// Ce test épingle cette tolérance ici : sans lui, une mutation qui détruisait une
// des trois formes reconnues par l'adaptateur claude laissait ce fichier VERT, et
// seuls `transcript.test.ts` et `transcript-subagents.test.ts` rougissaient.
test('une ligne d’usage préfixée d’un BOM est comptabilisée', () => {
  const BOM = String.fromCharCode(0xFEFF);
  const ligne = JSON.stringify({
    type: 'assistant', isSidechain: false,
    message: {
      id: 'msg_bom', model: 'claude-sonnet-4-5',
      usage: { input_tokens: 123, output_tokens: 45 },
    },
  });
  const rec: { id: string; tokens: any } = { id: 'sess-bom', tokens: null };
  ensureTokens(rec);

  expect(TRANSCRIPT_ADAPTERS.claude.parseUsageLine(BOM + ligne, rec), 'le décodage passe par la primitive commune, qui tolère le BOM').toBe(true);
  // Assertion discriminante : on nomme les jetons attendus, pas seulement le
  // booléen — un `true` sans comptabilisation serait une régression muette.
  expect(rec.tokens.main.in).toBe(123);
  expect(rec.tokens.main.out).toBe(45);
  expect(rec.tokens.main.lastModel).toBe('claude-sonnet-4-5');
});


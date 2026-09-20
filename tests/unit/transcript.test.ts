// parseTranscriptEvent — bridge between raw transcript JSONL lines and the
// per-bucket token accumulation. Verifies that:
//   - the model field travels from `evt.message.model` (main thread) and
//     `evt.data.message.message.model` (subagent stream) into the bucket
//   - non-token-bearing lines are correctly ignored (return false)
//   - the inline subagent bucket creation uses the full newBucket() shape so
//     pricing fields (costUsd, lastModel, contextMax) don't end up undefined

import { expect, test } from 'vitest';
import { _internals } from '../../src/server/transcript.ts';
import { ensureTokens } from '../../src/server/tokens.ts';
import type { SessionRecord } from '../../src/server/session-index.ts';

const { parseTranscriptEvent } = _internals;

// Fixture partielle : `tokens` est la tranche que tokens.ts pose lui-même sur
// l'enregistrement — `any` ici, jamais un `SessionRecord` complet.
type RecFixture = SessionRecord & { tokens: any };

function freshRec(): RecFixture {
  const rec = { id: 'test-sess', tokens: null } as unknown as RecFixture;
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
  expect(changed).toBe(true);
  expect(rec.tokens.main.in).toBe(1000);
  expect(rec.tokens.main.lastModel).toBe('claude-sonnet-4-5');
  expect(rec.tokens.main.contextMax > 0, 'contextMax must be set from pricing').toBeTruthy();
  // Sonnet 4.5: 1000*3e-6 + 500*1.5e-5 = 0.003 + 0.0075 = 0.0105
  expect(Math.abs(rec.tokens.main.costUsd - 0.0105) < 1e-9, `got ${rec.tokens.main.costUsd}`).toBeTruthy();
});

test('main-thread line is billed at the tariff in effect at its timestamp', () => {
  // The transcript line carries `timestamp`; it must travel down to pricing so
  // a September sonnet-5 message costs sticker rate (3e-6/token input) even if
  // the transcript is (re)parsed during the intro-price window.
  const rec = freshRec();
  const line = JSON.stringify({
    type: 'assistant',
    isSidechain: false,
    timestamp: '2026-09-15T10:00:00.000Z',
    message: {
      model: 'claude-sonnet-5',
      usage: {
        input_tokens: 1000, output_tokens: 0,
        cache_creation_input_tokens: 0, cache_read_input_tokens: 0,
      },
    },
  });
  expect(parseTranscriptEvent(line, rec)).toBe(true);
  expect(Math.abs(rec.tokens.main.costUsd - 0.003) < 1e-12, `got ${rec.tokens.main.costUsd}, expected 0.003 (sticker rate at message date)`).toBeTruthy();
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
  expect(changed).toBe(true);
  const bucket = rec.tokens.perAgent.get('agent-xyz');
  expect(bucket, 'agent bucket should be created').toBeTruthy();
  expect(bucket.in).toBe(2000);
  expect(bucket.lastModel).toBe('claude-haiku-4-5');
  // Verify the subagent bucket got the FULL newBucket shape — a partial inline
  // literal here leaves pricing fields undefined, and costUsd += ... returns NaN.
  expect(typeof bucket.costUsd).toBe('number');
  expect(!Number.isNaN(bucket.costUsd)).toBeTruthy();
  // Haiku: 2000*1e-6 + 100*5e-6 = 0.002 + 0.0005 = 0.0025
  expect(Math.abs(bucket.costUsd - 0.0025) < 1e-9, `got ${bucket.costUsd}`).toBeTruthy();
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
  expect(changed).toBe(true);
  const bucket = rec.tokens.perAgent.get('a0b3d9c1c934d0613');
  expect(bucket, 'subagent bucket should be created').toBeTruthy();
  expect(bucket.in).toBe(3);
  expect(bucket.cacheCreate).toBe(3364);
  expect(bucket.cacheRead).toBe(28466);
  expect(bucket.lastModel).toBe('claude-haiku-4-5');
  expect(bucket.contextMax > 0, 'contextMax must be set from pricing').toBeTruthy();
  expect(rec.tokens.main.in, 'main bucket must stay untouched').toBe(0);
});

test('sidechain assistant line without agentId is ignored (no miscrediting)', () => {
  // A sidechain line that lacks a top-level agentId can't be attributed to a
  // sub-agent bucket — it must be skipped rather than land in __main__.
  const rec = freshRec();
  const line = JSON.stringify({
    type: 'assistant', isSidechain: true,
    message: { model: 'claude-haiku-4-5', usage: { input_tokens: 100, output_tokens: 50 } },
  });
  expect(parseTranscriptEvent(line, rec)).toBe(false);
  expect(rec.tokens.main.in).toBe(0);
  expect(rec.tokens.perAgent.size).toBe(0);
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
    expect(parseTranscriptEvent(line, rec), `line should be ignored: ${line.slice(0, 40)}`).toBe(false);
  }
  expect(rec.tokens.main.in).toBe(0);
  expect(rec.tokens.main.costUsd).toBe(0);
  expect(rec.tokens.perAgent.size).toBe(0);
});

// Seule l'absence de `usage` écarte une ligne. Un `usage` qui n'est pas un objet
// arrive jusqu'au seau, qui le compte à part, au lieu de disparaître ici sans trace.
// Un test de vérité (`!usage`) écarterait aussi `0`, `false` et `""`.
type CasUsageNonObjet = [
  string,
  string | number,
  (usage: any) => Record<string, any>,
  (rec: RecFixture) => any,
];

const USAGE_NON_OBJET: CasUsageNonObjet[] = [
  ['fil principal', 'x',
    (usage) => ({ type: 'assistant', isSidechain: false, message: { model: 'claude-sonnet-4-5', usage } }),
    (rec) => rec.tokens.main],
  ['fil principal', 0,
    (usage) => ({ type: 'assistant', isSidechain: false, message: { model: 'claude-sonnet-4-5', usage } }),
    (rec) => rec.tokens.main],
  ['sous-agent à fichier propre', 0,
    (usage) => ({ type: 'assistant', isSidechain: true, agentId: 'agent-nonobjet', message: { model: 'claude-haiku-4-5', usage } }),
    (rec) => rec.tokens.perAgent.get('agent-nonobjet')],
  ['sous-agent en agent_progress', 0,
    (usage) => ({ type: 'progress', data: { type: 'agent_progress', agentId: 'agent-nonobjet', message: { message: { model: 'claude-haiku-4-5', usage } } } }),
    (rec) => rec.tokens.perAgent.get('agent-nonobjet')],
];

for (const [forme, valeur, ligne, seau] of USAGE_NON_OBJET) {
  test(`${forme} : un usage ${JSON.stringify(valeur)} n'est pas écarté, la ligne compte zéro jeton`, () => {
    // Arrange
    const rec = freshRec();
    const line = JSON.stringify(ligne(valeur));

    // Act
    const changed = parseTranscriptEvent(line, rec);

    // Assert
    expect(changed).toBe(true);
    expect(seau(rec).in).toBe(0);
  });

  test(`${forme} : un usage ${JSON.stringify(valeur)} rend le coût partiel et se compte à part`, () => {
    // Arrange
    const rec = freshRec();
    const line = JSON.stringify(ligne(valeur));

    // Act
    parseTranscriptEvent(line, rec);

    // Assert
    expect(seau(rec).costComplete).toBe(false);
    expect(seau(rec).malformedUsageMessages).toBe(1);
  });
}

test('un usage null est écarté comme un usage absent : aucun seau ne bouge', () => {
  // Arrange
  const rec = freshRec();
  const line = JSON.stringify({ type: 'assistant', isSidechain: false, message: { model: 'claude-sonnet-4-5', usage: null } });

  // Act
  const changed = parseTranscriptEvent(line, rec);

  // Assert
  expect(changed).toBe(false);
  expect(rec.tokens.main.lastModel).toBe(null);
  expect(rec.tokens.perAgent.size).toBe(0);
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
  expect(parseTranscriptEvent(line, rec)).toBe(true);
  expect(rec.tokens.main.in).toBe(500);
  expect(rec.tokens.main.lastModel).toBe(null);
  expect(rec.tokens.main.costUsd).toBe(0);
});

test('parseTranscriptEvent short-circuits when line lacks "usage" substring', () => {
  // Cheap pre-filter avoids a JSON.parse on every system event / user message
  // / tool result line in a multi-MB transcript. Verify it really skips and
  // doesn't false-negative on a usage-bearing line.
  const rec = freshRec();
  // No "usage" substring → must short-circuit. Doesn't matter that it's valid JSON.
  expect(parseTranscriptEvent('{"type":"user","content":"hi"}', rec)).toBe(false);
  // Empty / null / non-string → must not throw.
  expect(parseTranscriptEvent('', rec)).toBe(false);
  expect(parseTranscriptEvent(null as any, rec)).toBe(false);
  // The substring must trigger the parse path.
  const line = JSON.stringify({
    type: 'assistant', isSidechain: false,
    message: { model: 'claude-sonnet-4-5', usage: { input_tokens: 1, output_tokens: 1 } },
  });
  expect(parseTranscriptEvent(line, rec)).toBe(true);
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
  expect(bucket.in).toBe(2000);
  // lastModel = the most recent one (last-wins, like the lastIn fields)
  expect(bucket.lastModel).toBe('claude-sonnet-4-5');
  // Cost summed across both rates: 1000*1e-6 (haiku) + 1000*3e-6 (sonnet) = 0.001 + 0.003 = 0.004
  expect(Math.abs(bucket.costUsd - 0.004) < 1e-9, `got ${bucket.costUsd}`).toBeTruthy();
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
  expect(parseTranscriptEvent(line, rec)).toBe(false);
  expect(rec.tokens.main.in).toBe(0);
  expect(rec.tokens.main.costUsd).toBe(0);
});

test('parseTranscriptEvent with agentSource=undefined still parses as Claude', () => {
  // A session recorded without --source has no agentSource: it must keep working.
  const rec = freshRec();
  // rec.agentSource stays undefined
  const line = JSON.stringify({
    type: 'assistant', isSidechain: false,
    message: { model: 'claude-sonnet-4-5', usage: { input_tokens: 100, output_tokens: 50 } },
  });
  expect(parseTranscriptEvent(line, rec)).toBe(true);
  expect(rec.tokens.main.in).toBe(100);
});

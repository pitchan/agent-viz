// Regression: transcript discovery robustness.
//
// Two historical bugs silently disabled token tracking for a whole session:
//   Bug 1 — getTranscriptPath only scanned the first 16 KB of the event file
//           for a newline; a first hook event larger than that (e.g. a long
//           UserPromptSubmit) made discovery return null.
//   Bug 2 — a transient fsp.access miss (the transcript file not yet created
//           when SessionStart is processed) latched discovery as permanently
//           failed, so it never retried even once the file appeared.
// Plus: while the transcript stays unreachable, the token snapshot must carry
// a `transcriptMissing` flag so the UI can show an explicit state.

import { expect, test } from 'vitest';
import fs from 'node:fs';
const fsp = fs.promises;
import path from 'node:path';
import os from 'node:os';

import {
  getTranscriptPath, ensureTranscriptWatcher, closeTranscriptResources, _internals,
} from '../../src/server/transcript.ts';
import { tokensSnapshot, ensureTokens, clearTokensTimer } from '../../src/server/tokens.ts';
import { sessionIndex } from '../../src/server/session-index.ts';
import type { SessionRecord } from '../../src/server/session-index.ts';

const { readFirstLine } = _internals;

// Fixture partielle : ces tests ne posent que les champs qu'ils lisent, jamais
// le `SessionRecord` complet. `transcript`/`tokens` restent `any` — ce sont les
// tranches que `transcript.ts`/`tokens.ts` posent eux-mêmes sur l'enregistrement.
type RecFixture = SessionRecord & { transcript: any; tokens: any };

async function tmpDir() {
  return fsp.mkdtemp(path.join(os.tmpdir(), 'aviz-disc-'));
}

const claudeUsageLine = (model: string, inTok: number, outTok: number) => JSON.stringify({
  type: 'assistant', isSidechain: false,
  message: { model, usage: { input_tokens: inTok, output_tokens: outTok } },
}) + '\n';

// ───────────────────────────── Bug 1 ─────────────────────────────

test('readFirstLine returns a complete line longer than 16 KB', async () => {
  const dir = await tmpDir();
  const file = path.join(dir, 'f.jsonl');
  const big = 'x'.repeat(64 * 1024);
  await fsp.writeFile(file, big + '\n' + 'second\n');
  expect(await readFirstLine(file)).toBe(big);
  await fsp.rm(dir, { recursive: true, force: true });
});

test('readFirstLine returns the only line of a file with no trailing newline', async () => {
  const dir = await tmpDir();
  const file = path.join(dir, 'f.jsonl');
  await fsp.writeFile(file, 'only line, no newline');
  expect(await readFirstLine(file)).toBe('only line, no newline');
  await fsp.rm(dir, { recursive: true, force: true });
});

test('getTranscriptPath extracts transcript_path when the first event exceeds 16 KB', async () => {
  const dir = await tmpDir();
  const sessionFile = path.join(dir, 'sess.jsonl');
  const transcriptPath = path.join(dir, 'transcript.jsonl');
  // A UserPromptSubmit event with a 64 KB prompt → JSON line well past 16 KB.
  await fsp.writeFile(sessionFile, JSON.stringify({
    hook_event_name: 'UserPromptSubmit', _source: 'claude', session_id: 'sess',
    transcript_path: transcriptPath, prompt: 'A'.repeat(64 * 1024),
  }) + '\n');
  expect(await getTranscriptPath(sessionFile)).toBe(transcriptPath);
  await fsp.rm(dir, { recursive: true, force: true });
});

// ─────────────────────── Première ligne ───────────────────────
// Le décodage d'une ligne passe par la primitive commune du moteur, qui ne lève
// jamais : `getTranscriptPath` écrit donc explicitement la trace d'une première
// ligne illisible, et décode une première ligne préfixée d'un BOM.

test('getTranscriptPath still leaves a trace when the first line is unreadable', async () => {
  // Arrange — une première ligne coupée en plein milieu, comme un fichier
  // tronqué par un arrêt brutal. Sans trace, la découverte échouerait sans un
  // mot et la session perdrait tout son suivi de jetons.
  const dir = await tmpDir();
  const sessionFile = path.join(dir, 'sess.jsonl');
  await fsp.writeFile(sessionFile, '{"hook_event_name":"UserPro\n');
  const dits: string[] = [];
  const vraiErr = console.error;
  console.error = (...a) => dits.push(a.map(String).join(' '));

  // Act
  let trouve;
  try { trouve = await getTranscriptPath(sessionFile); }
  finally { console.error = vraiErr; }

  // Assert
  expect(trouve).toBe(null);
  expect(dits.join('\n')).toMatch(/unreadable first line/);
  await fsp.rm(dir, { recursive: true, force: true });
});

test('getTranscriptPath decodes a first line prefixed with a BOM', async () => {
  // Arrange
  const dir = await tmpDir();
  const sessionFile = path.join(dir, 'sess.jsonl');
  const transcriptPath = path.join(dir, 'transcript.jsonl');
  await fsp.writeFile(sessionFile, '\uFEFF' + JSON.stringify({
    hook_event_name: 'SessionStart', _source: 'claude', session_id: 'sess',
    transcript_path: transcriptPath,
  }) + '\n');

  // Act
  const trouve = await getTranscriptPath(sessionFile);

  // Assert
  expect(trouve).toBe(transcriptPath);
  await fsp.rm(dir, { recursive: true, force: true });
});

// ───────────────────────────── Bug 2 ─────────────────────────────

test('ensureTranscriptWatcher retries discovery after a transient missing transcript', async () => {
  const dir = await tmpDir();
  const id = 'retry-sess-1';
  const sessionFile = path.join(dir, id + '.jsonl');
  const transcriptPath = path.join(dir, 'transcript.jsonl');
  await fsp.writeFile(sessionFile, JSON.stringify({
    hook_event_name: 'SessionStart', _source: 'claude',
    session_id: id, transcript_path: transcriptPath,
  }) + '\n');
  const rec = { id, agentSource: 'claude', tokens: null } as unknown as RecFixture;
  sessionIndex.set(id, rec);
  try {
    // Transcript file does not exist yet → discovery must not latch.
    await ensureTranscriptWatcher(sessionFile);
    expect(rec.transcript.main, 'main tail must not be set while transcript is absent').toBe(null);

    // Transcript appears with a usage line.
    await fsp.writeFile(transcriptPath, claudeUsageLine('claude-sonnet-4-5', 1234, 10));

    // Retry must succeed — there is no permanent lock.
    await ensureTranscriptWatcher(sessionFile);
    expect(rec.transcript.main, 'main tail must be established on retry').toBeTruthy();
    expect(rec.tokens.main.in).toBe(1234);
  } finally {
    closeTranscriptResources(rec);
    clearTokensTimer(rec);
    sessionIndex.delete(id);
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

// ─────────────────────── transcriptMissing ───────────────────────

test('tokensSnapshot reports transcriptMissing', () => {
  const rec: { id: string; tokens: any } = { id: 'snap-sess', tokens: null };
  ensureTokens(rec);
  expect(tokensSnapshot(rec)!.transcriptMissing).toBe(false);
  rec.tokens.transcriptMissing = true;
  expect(tokensSnapshot(rec)!.transcriptMissing).toBe(true);
});

test('ensureTranscriptWatcher flags transcriptMissing while absent and clears it on success', async () => {
  const dir = await tmpDir();
  const id = 'retry-sess-2';
  const sessionFile = path.join(dir, id + '.jsonl');
  const transcriptPath = path.join(dir, 'transcript.jsonl');
  await fsp.writeFile(sessionFile, JSON.stringify({
    hook_event_name: 'SessionStart', _source: 'claude',
    session_id: id, transcript_path: transcriptPath,
  }) + '\n');
  const rec = { id, agentSource: 'claude', tokens: null } as unknown as RecFixture;
  sessionIndex.set(id, rec);
  try {
    await ensureTranscriptWatcher(sessionFile);
    const missing = tokensSnapshot(rec);
    expect(missing && missing.transcriptMissing, 'flagged missing while transcript absent').toBe(true);

    await fsp.writeFile(transcriptPath, claudeUsageLine('claude-sonnet-4-5', 500, 5));
    await ensureTranscriptWatcher(sessionFile);
    expect(tokensSnapshot(rec)!.transcriptMissing, 'cleared once transcript discovered').toBe(false);
  } finally {
    closeTranscriptResources(rec);
    clearTokensTimer(rec);
    sessionIndex.delete(id);
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

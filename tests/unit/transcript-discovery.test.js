'use strict';
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

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');

const {
  getTranscriptPath, ensureTranscriptWatcher, closeTranscriptResources, _internals,
} = require('../../lib/server/transcript');
const { tokensSnapshot, ensureTokens, clearTokensTimer } = require('../../lib/server/tokens');
const { sessionIndex } = require('../../lib/server/session-index');

const { readFirstLine } = _internals;

async function tmpDir() {
  return fsp.mkdtemp(path.join(os.tmpdir(), 'aviz-disc-'));
}

const claudeUsageLine = (model, inTok, outTok) => JSON.stringify({
  type: 'assistant', isSidechain: false,
  message: { model, usage: { input_tokens: inTok, output_tokens: outTok } },
}) + '\n';

// ───────────────────────────── Bug 1 ─────────────────────────────

test('readFirstLine returns a complete line longer than 16 KB', async () => {
  const dir = await tmpDir();
  const file = path.join(dir, 'f.jsonl');
  const big = 'x'.repeat(64 * 1024);
  await fsp.writeFile(file, big + '\n' + 'second\n');
  assert.equal(await readFirstLine(file), big);
  await fsp.rm(dir, { recursive: true, force: true });
});

test('readFirstLine returns the only line of a file with no trailing newline', async () => {
  const dir = await tmpDir();
  const file = path.join(dir, 'f.jsonl');
  await fsp.writeFile(file, 'only line, no newline');
  assert.equal(await readFirstLine(file), 'only line, no newline');
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
  assert.equal(await getTranscriptPath(sessionFile), transcriptPath);
  await fsp.rm(dir, { recursive: true, force: true });
});

// ───────────────────────────── C2 ─────────────────────────────
// 2026-08-11 : le décodage d'une ligne passe désormais par la primitive commune
// du moteur, qui ne lève jamais. Le `catch` de `getTranscriptPath` a donc cessé
// d'être le filet d'une première ligne illisible, et la trace qu'il écrivait est
// maintenant écrite explicitement. Ces deux tests tiennent les deux bouts de ce
// changement : ce qui ne doit pas disparaître, et ce qui doit désormais passer.

test('getTranscriptPath still leaves a trace when the first line is unreadable', async () => {
  // Arrange — une première ligne coupée en plein milieu, comme un fichier
  // tronqué par un arrêt brutal. Sans trace, la découverte échouerait sans un
  // mot et la session perdrait tout son suivi de jetons : la perte silencieuse
  // que C1 a coûté une fois déjà.
  const dir = await tmpDir();
  const sessionFile = path.join(dir, 'sess.jsonl');
  await fsp.writeFile(sessionFile, '{"hook_event_name":"UserPro\n');
  const dits = [];
  const vraiErr = console.error;
  console.error = (...a) => dits.push(a.map(String).join(' '));

  // Act
  let trouve;
  try { trouve = await getTranscriptPath(sessionFile); }
  finally { console.error = vraiErr; }

  // Assert
  assert.equal(trouve, null);
  assert.match(dits.join('\n'), /unreadable first line/);
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
  assert.equal(trouve, transcriptPath);
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
  const rec = { id, agentSource: 'claude', tokens: null };
  sessionIndex.set(id, rec);
  try {
    // Transcript file does not exist yet → discovery must not latch.
    await ensureTranscriptWatcher(sessionFile);
    assert.equal(rec.transcript.main, null, 'main tail must not be set while transcript is absent');

    // Transcript appears with a usage line.
    await fsp.writeFile(transcriptPath, claudeUsageLine('claude-sonnet-4-5', 1234, 10));

    // Retry must succeed — there is no permanent lock.
    await ensureTranscriptWatcher(sessionFile);
    assert.ok(rec.transcript.main, 'main tail must be established on retry');
    assert.equal(rec.tokens.main.in, 1234);
  } finally {
    closeTranscriptResources(rec);
    clearTokensTimer(rec);
    sessionIndex.delete(id);
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

// ──────────────────────────── Partie 3 ────────────────────────────

test('tokensSnapshot reports transcriptMissing', () => {
  const rec = { id: 'snap-sess', tokens: null };
  ensureTokens(rec);
  assert.equal(tokensSnapshot(rec).transcriptMissing, false);
  rec.tokens.transcriptMissing = true;
  assert.equal(tokensSnapshot(rec).transcriptMissing, true);
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
  const rec = { id, agentSource: 'claude', tokens: null };
  sessionIndex.set(id, rec);
  try {
    await ensureTranscriptWatcher(sessionFile);
    const missing = tokensSnapshot(rec);
    assert.equal(missing && missing.transcriptMissing, true, 'flagged missing while transcript absent');

    await fsp.writeFile(transcriptPath, claudeUsageLine('claude-sonnet-4-5', 500, 5));
    await ensureTranscriptWatcher(sessionFile);
    assert.equal(tokensSnapshot(rec).transcriptMissing, false, 'cleared once transcript discovered');
  } finally {
    closeTranscriptResources(rec);
    clearTokensTimer(rec);
    sessionIndex.delete(id);
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

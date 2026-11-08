// Codex remplace ses anciens transcripts `x.jsonl` par `x.jsonl.zst`, alors que les événements du
// hook nomment toujours `x.jsonl`. Une session rouverte garde ses jetons et sa question.
// Formes de lignes reprises de transcripts Codex réels, contenu remplacé.

import { expect, test } from 'vitest';
import fs from 'node:fs';
const fsp = fs.promises;
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';

import { ensureTranscriptWatcher, ensureFirstPrompt, closeTranscriptResources } from '../../src/server/transcript.ts';
import { tokensSnapshot, tokenSum, clearTokensTimer } from '../../src/server/tokens.ts';
import { sessionIndex } from '../../src/server/session-index.ts';
import type { SessionRecord } from '../../src/server/session-index.ts';

type RecFixture = SessionRecord & { transcript: any; tokens: any };

const HORODATAGE = '2026-10-22T19:24:20.000Z';
const SESSION = '01a16512-3b6e-7310-9b36-0000000000a1';
const ENFANT = '01a16512-a34c-7d00-8f94-0000000000b2';
const QUESTION = 'Compare les deux variantes du benchmark';

function ligne(ordinal: number, type: string, payload: Record<string, unknown>): string {
  return JSON.stringify({ timestamp: HORODATAGE, ordinal, type, payload });
}

function compteurs(input: number, cached: number, output: number) {
  return {
    input_tokens: input, cached_input_tokens: cached, cache_write_input_tokens: 0,
    output_tokens: output, reasoning_output_tokens: 0, total_tokens: input + output,
  };
}

function jetons(ordinal: number, cumul: ReturnType<typeof compteurs>, appel: ReturnType<typeof compteurs>): string {
  return ligne(ordinal, 'event_msg', {
    type: 'token_count', info: { total_token_usage: cumul, last_token_usage: appel, model_context_window: 258400 },
  });
}

const tour = (ordinal: number) => ligne(ordinal, 'turn_context', { turn_id: 't1', model: 'gpt-5.5' });
const question = (ordinal: number) => ligne(ordinal, 'event_msg', {
  type: 'item_completed', item: { type: 'UserMessage', content: [{ type: 'text', text: QUESTION }] },
});

const P1 = compteurs(19178, 7296, 71);
const P2 = compteurs(20176, 19072, 110);
const P_CUMUL = compteurs(P1.input_tokens + P2.input_tokens, P1.cached_input_tokens + P2.cached_input_tokens, P1.output_tokens + P2.output_tokens);
const A1 = compteurs(19939, 0, 78);

function evenement(nom: string, transcript: string, agentId?: string): Record<string, unknown> {
  const evt: Record<string, unknown> = { _source: 'codex', hook_event_name: nom, session_id: SESSION, transcript_path: transcript };
  if (agentId !== undefined) evt.agent_id = agentId;
  return evt;
}

function contenu(lignes: (string | Record<string, unknown>)[]): string {
  return lignes.map(l => (typeof l === 'string' ? l : JSON.stringify(l)) + '\n').join('');
}

// Seul `<fichier>.zst` existe sur le disque, comme après le passage de Codex.
async function ecrireCompresse(fichier: string, lignes: string[]): Promise<void> {
  await fsp.writeFile(fichier + '.zst', zlib.zstdCompressSync(Buffer.from(contenu(lignes))));
}

async function session() {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'aviz-codex-zst-'));
  const transcript = path.join(dir, `rollout-p-${SESSION}.jsonl`);
  const enfant = path.join(dir, `rollout-a-${ENFANT}.jsonl`);
  const evenements = path.join(dir, `${SESSION}.jsonl`);
  await ecrireCompresse(transcript, [
    ligne(0, 'session_meta', { id: SESSION, session_id: SESSION, thread_source: 'user' }),
    tour(1), question(2), jetons(3, P1, P1), jetons(4, P_CUMUL, P2),
  ]);
  const rec = { id: SESSION, agentSource: 'codex', tokens: null } as unknown as RecFixture;
  sessionIndex.set(SESSION, rec);
  const fin = async () => {
    closeTranscriptResources(rec);
    clearTokensTimer(rec);
    sessionIndex.delete(SESSION);
    await fsp.rm(dir, { recursive: true, force: true });
  };
  return { transcript, enfant, evenements, rec, fin };
}

test('une session Codex dont le transcript est compressé garde ses jetons', async () => {
  // Arrange
  const s = await session();
  await fsp.writeFile(s.evenements, contenu([evenement('SessionStart', s.transcript), evenement('Stop', s.transcript)]));
  try {
    // Act
    await ensureTranscriptWatcher(s.evenements);
    // Assert
    const snap = tokensSnapshot(s.rec)!;
    expect(snap.transcriptMissing).toBe(false);
    expect(tokenSum(snap.main)).toBe(P_CUMUL.total_tokens);
  } finally {
    await s.fin();
  }
});

test('le sous-agent d’une session Codex compressée garde ses jetons', async () => {
  // Arrange
  const s = await session();
  await ecrireCompresse(s.enfant, [
    ligne(0, 'session_meta', { id: ENFANT, session_id: SESSION, parent_thread_id: SESSION, thread_source: 'subagent' }),
    tour(1), jetons(2, A1, A1),
  ]);
  await fsp.writeFile(s.evenements, contenu([evenement('SessionStart', s.transcript), evenement('PreToolUse', s.enfant, ENFANT)]));
  try {
    // Act
    await ensureTranscriptWatcher(s.evenements);
    // Assert
    const snap = tokensSnapshot(s.rec)!;
    expect(tokenSum(snap.main)).toBe(P_CUMUL.total_tokens);
    expect(tokenSum(snap.perAgent[ENFANT])).toBe(A1.total_tokens);
  } finally {
    await s.fin();
  }
});

test('une session Codex dont le transcript est compressé garde sa question', async () => {
  // Arrange
  const s = await session();
  await fsp.writeFile(s.evenements, contenu([evenement('SessionStart', s.transcript)]));
  try {
    // Act
    const prompt = await ensureFirstPrompt(s.evenements);
    // Assert
    expect(prompt).toBe(QUESTION);
  } finally {
    await s.fin();
  }
});

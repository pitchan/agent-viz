// Jetons des sous-agents Codex : chaque sous-agent a son propre transcript, nommé par le
// `transcript_path` de ses événements, et ses jetons vont dans le seau de son `agent_id`.
// Formes de lignes reprises de transcripts Codex réels (0.162 et 0.163), contenu remplacé.

import { expect, test } from 'vitest';
import fs from 'node:fs';
const fsp = fs.promises;
import path from 'node:path';
import os from 'node:os';

import { ensureTranscriptWatcher, closeTranscriptResources } from '../../src/server/transcript.ts';
import { tokensSnapshot, tokenSum, clearTokensTimer } from '../../src/server/tokens.ts';
import { sessionIndex } from '../../src/server/session-index.ts';
import type { SessionRecord } from '../../src/server/session-index.ts';

type RecFixture = SessionRecord & { transcript: any; tokens: any };

const HORODATAGE = '2026-10-29T22:39:40.000Z';
const PARENT = '01a189d1-6775-7a03-a7ed-362f0d36a787';
const ENFANT_A = '01a189d1-a34c-7d00-8f94-737b8d7366a2';
const ENFANT_B = '01a189d1-b10d-7473-ab3c-ad79397a0050';

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

function metaParent(): string {
  return ligne(0, 'session_meta', { id: PARENT, session_id: PARENT, thread_source: 'user' });
}

function metaEnfant(id: string, herite?: { debut: number }): string {
  const payload: Record<string, unknown> = {
    id, session_id: PARENT, parent_thread_id: PARENT, thread_source: 'subagent',
    agent_path: `/root/${id.slice(-4)}`, agent_nickname: 'Einstein',
  };
  if (herite) {
    payload.forked_from_id = PARENT;
    payload.subagent_history_start_ordinal = herite.debut;
  }
  return ligne(0, 'session_meta', payload);
}

const P1 = compteurs(19178, 7296, 71);
const P2 = compteurs(20176, 19072, 110);
const P_CUMUL = compteurs(P1.input_tokens + P2.input_tokens, P1.cached_input_tokens + P2.cached_input_tokens, P1.output_tokens + P2.output_tokens);
const A1 = compteurs(19939, 0, 78);
const A2 = compteurs(20079, 19840, 13);
const A_CUMUL = compteurs(A1.input_tokens + A2.input_tokens, A1.cached_input_tokens + A2.cached_input_tokens, A1.output_tokens + A2.output_tokens);
const B1 = compteurs(19940, 19712, 73);

function evenement(nom: string, transcript: string, agentId?: string): Record<string, unknown> {
  const evt: Record<string, unknown> = {
    _source: 'codex', hook_event_name: nom, session_id: PARENT, transcript_path: transcript,
  };
  if (agentId !== undefined) evt.agent_id = agentId;
  return evt;
}

async function ecrireJsonl(fichier: string, lignes: (string | Record<string, unknown>)[]): Promise<void> {
  await fsp.writeFile(fichier, lignes.map(l => (typeof l === 'string' ? l : JSON.stringify(l)) + '\n').join(''));
}

async function session() {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'aviz-codex-sub-'));
  const parent = path.join(dir, `rollout-p-${PARENT}.jsonl`);
  const enfantA = path.join(dir, `rollout-a-${ENFANT_A}.jsonl`);
  const enfantB = path.join(dir, `rollout-b-${ENFANT_B}.jsonl`);
  const evenements = path.join(dir, `${PARENT}.jsonl`);
  await ecrireJsonl(parent, [metaParent(), tour(1), jetons(2, P1, P1), jetons(3, P_CUMUL, P2)]);
  const rec = { id: PARENT, agentSource: 'codex', tokens: null } as unknown as RecFixture;
  sessionIndex.set(PARENT, rec);
  const fin = async () => {
    closeTranscriptResources(rec);
    clearTokensTimer(rec);
    sessionIndex.delete(PARENT);
    await fsp.rm(dir, { recursive: true, force: true });
  };
  return { dir, parent, enfantA, enfantB, evenements, rec, fin };
}

test('les jetons de chaque sous-agent Codex vont dans le seau de ce sous-agent, ceux du parent restent au parent', async () => {
  // Arrange
  const s = await session();
  await ecrireJsonl(s.enfantA, [metaEnfant(ENFANT_A), tour(1), jetons(2, A1, A1), jetons(3, A_CUMUL, A2)]);
  await ecrireJsonl(s.enfantB, [metaEnfant(ENFANT_B), tour(1), jetons(2, B1, B1)]);
  await ecrireJsonl(s.evenements, [
    evenement('SessionStart', s.parent),
    evenement('PreToolUse', s.enfantA, ENFANT_A),
    evenement('PreToolUse', s.enfantB, ENFANT_B),
    // La fin d'un sous-agent est écrite avec le transcript du parent.
    evenement('SubagentStop', s.parent, ENFANT_A),
  ]);
  try {
    // Act
    await ensureTranscriptWatcher(s.evenements);
    // Assert
    const snap = tokensSnapshot(s.rec)!;
    expect(snap.tokensSupported).toBe(true);
    expect(tokenSum(snap.main)).toBe(P_CUMUL.total_tokens);
    expect(Object.keys(snap.perAgent).sort()).toEqual([ENFANT_A, ENFANT_B].sort());
    expect(tokenSum(snap.perAgent[ENFANT_A])).toBe(A_CUMUL.total_tokens);
    expect(tokenSum(snap.perAgent[ENFANT_B])).toBe(B1.total_tokens);
  } finally {
    await s.fin();
  }
});

test('un sous-agent qui hérite de l’historique du parent ne compte que ses propres lignes', async () => {
  // Arrange — les lignes d'ordinal inférieur au début déclaré sont la copie du parent
  const s = await session();
  await ecrireJsonl(s.enfantA, [
    metaEnfant(ENFANT_A, { debut: 4 }),
    metaParent().replace('"ordinal":0', '"ordinal":1'),
    tour(2),
    jetons(3, P1, P1),
    tour(4),
    jetons(5, A1, A1),
  ]);
  await ecrireJsonl(s.evenements, [evenement('SessionStart', s.parent), evenement('PostToolUse', s.enfantA, ENFANT_A)]);
  try {
    // Act
    await ensureTranscriptWatcher(s.evenements);
    // Assert
    const snap = tokensSnapshot(s.rec)!;
    expect(snap.tokensSupported).toBe(true);
    expect(tokenSum(snap.main)).toBe(P_CUMUL.total_tokens);
    expect(tokenSum(snap.perAgent[ENFANT_A])).toBe(A1.total_tokens);
  } finally {
    await s.fin();
  }
});

test('un transcript de sous-agent réécrit dont toutes les lignes sont la copie du parent ne compte rien', async () => {
  // Arrange — début égal au nombre de lignes, copie contenant des jetons du parent
  const s = await session();
  await ecrireJsonl(s.enfantA, [metaEnfant(ENFANT_A, { debut: 4 }), tour(1), jetons(2, P1, P1), jetons(3, P_CUMUL, P2)]);
  await ecrireJsonl(s.evenements, [evenement('SessionStart', s.parent), evenement('PreToolUse', s.enfantA, ENFANT_A)]);
  try {
    // Act
    await ensureTranscriptWatcher(s.evenements);
    // Assert
    const snap = tokensSnapshot(s.rec)!;
    expect(snap.tokensSupported).toBe(true);
    expect(tokenSum(snap.main)).toBe(P_CUMUL.total_tokens);
    expect(tokenSum(snap.perAgent[ENFANT_A])).toBe(0);
  } finally {
    await s.fin();
  }
});

test('un sous-agent apparu après la première lecture est rattrapé, sans recompter les autres', async () => {
  // Arrange
  const s = await session();
  await ecrireJsonl(s.enfantA, [metaEnfant(ENFANT_A), tour(1), jetons(2, A1, A1)]);
  await ecrireJsonl(s.enfantB, [metaEnfant(ENFANT_B), tour(1), jetons(2, B1, B1)]);
  await ecrireJsonl(s.evenements, [evenement('SessionStart', s.parent), evenement('PreToolUse', s.enfantA, ENFANT_A)]);
  try {
    await ensureTranscriptWatcher(s.evenements);
    await fsp.appendFile(s.evenements, JSON.stringify(evenement('PreToolUse', s.enfantB, ENFANT_B)) + '\n');
    // Act
    await ensureTranscriptWatcher(s.evenements);
    // Assert
    const snap = tokensSnapshot(s.rec)!;
    expect(tokenSum(snap.main)).toBe(P_CUMUL.total_tokens);
    expect(tokenSum(snap.perAgent[ENFANT_A])).toBe(A1.total_tokens);
    expect(tokenSum(snap.perAgent[ENFANT_B])).toBe(B1.total_tokens);
  } finally {
    await s.fin();
  }
});

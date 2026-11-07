// Le transcript du fil principal d'une session dont le fichier d'événements commence par un
// événement de sous-agent (hook installé en cours de session, fichier compacté).
// Formes de lignes reprises de transcripts Codex réels (0.163), contenu remplacé.

import { expect, test } from 'vitest';
import fs from 'node:fs';
const fsp = fs.promises;
import path from 'node:path';
import os from 'node:os';

import { ensureTranscriptWatcher, ensureFirstPrompt, closeTranscriptResources } from '../../src/server/transcript.ts';
import { tokensSnapshot, tokenSum, clearTokensTimer } from '../../src/server/tokens.ts';
import { sessionIndex } from '../../src/server/session-index.ts';
import type { SessionRecord } from '../../src/server/session-index.ts';

type RecFixture = SessionRecord & { transcript: any; tokens: any };

const HORODATAGE = '2026-10-29T22:39:00.000Z';
const PARENT = '01a189d0-da10-73d3-80e9-ad9915140001';
const ENFANT = '01a189d1-0a22-7412-99c7-21eb23cf0002';

function ligne(ordinal: number, type: string, payload: Record<string, unknown>): string {
  return JSON.stringify({ timestamp: HORODATAGE, ordinal, type, payload });
}

function compteurs(input: number, cached: number, output: number) {
  return {
    input_tokens: input, cached_input_tokens: cached, cache_write_input_tokens: 0,
    output_tokens: output, reasoning_output_tokens: 0, total_tokens: input + output,
  };
}

function jetons(ordinal: number, appel: ReturnType<typeof compteurs>): string {
  return ligne(ordinal, 'event_msg', {
    type: 'token_count', info: { total_token_usage: appel, last_token_usage: appel, model_context_window: 475000 },
  });
}

const tour = (ordinal: number) => ligne(ordinal, 'turn_context', { turn_id: 't1', model: 'gpt-5.5' });

function question(ordinal: number, texte: string): string {
  return ligne(ordinal, 'event_msg', {
    type: 'item_completed', item: { type: 'UserMessage', content: [{ type: 'text', text: texte }] },
  });
}

function metaParent(): string {
  return ligne(0, 'session_meta', { id: PARENT, session_id: PARENT });
}

// Un sous-agent dérivé sans fin de copie déclarée : la forme des sous-agents de Codex 0.163.
function metaEnfant(derive: boolean): string {
  const payload: Record<string, unknown> = { id: ENFANT, session_id: PARENT, parent_thread_id: PARENT };
  if (derive) payload.forked_from_id = PARENT;
  return ligne(0, 'session_meta', payload);
}

const P1 = compteurs(19279, 0, 71);
const A1 = compteurs(19993, 18944, 28);

function evenement(source: string, nom: string, transcript: string, agentId?: string): Record<string, unknown> {
  const evt: Record<string, unknown> = { _source: source, hook_event_name: nom, session_id: PARENT, transcript_path: transcript };
  if (agentId !== undefined) evt.agent_id = agentId;
  return evt;
}

async function ecrireJsonl(fichier: string, lignes: (string | Record<string, unknown>)[]): Promise<void> {
  await fsp.writeFile(fichier, lignes.map(l => (typeof l === 'string' ? l : JSON.stringify(l)) + '\n').join(''));
}

async function session(source: string) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'aviz-main-apres-sub-'));
  const rec = { id: PARENT, agentSource: source, tokens: null } as unknown as RecFixture;
  sessionIndex.set(PARENT, rec);
  const fin = async () => {
    closeTranscriptResources(rec);
    clearTokensTimer(rec);
    sessionIndex.delete(PARENT);
    await fsp.rm(dir, { recursive: true, force: true });
  };
  return {
    parent: path.join(dir, `rollout-p-${PARENT}.jsonl`),
    enfant: path.join(dir, `rollout-a-${ENFANT}.jsonl`),
    evenements: path.join(dir, `${PARENT}.jsonl`),
    rec, fin,
  };
}

async function sessionCodex(enfantDerive: boolean, premier: string) {
  const s = await session('codex');
  await ecrireJsonl(s.parent, [metaParent(), question(1, 'question du fil principal'), tour(2), jetons(3, P1)]);
  await ecrireJsonl(s.enfant, [metaEnfant(enfantDerive), question(1, 'consigne du sous-agent'), tour(2), jetons(3, A1)]);
  await ecrireJsonl(s.evenements, [
    evenement('codex', premier, s.enfant, ENFANT),
    evenement('codex', 'SessionStart', s.parent),
    evenement('codex', 'UserPromptSubmit', s.parent),
  ]);
  return s;
}

test('Codex : un sous-agent dérivé en tête du fichier d’événements ne rend pas la session illisible', async () => {
  // Arrange — le hook installé en cours de session écrit d'abord le début des sous-agents déjà lancés
  const s = await sessionCodex(true, 'SubagentStart');
  try {
    // Act
    await ensureTranscriptWatcher(s.evenements);
    // Assert
    const snap = tokensSnapshot(s.rec)!;
    expect(snap.tokensSupported).toBe(true);
    expect(tokenSum(snap.main)).toBe(P1.total_tokens);
  } finally {
    await s.fin();
  }
});

test('Codex : avec un sous-agent en tête du fichier d’événements, le fil principal garde ses propres jetons', async () => {
  // Arrange — un fichier compacté peut commencer par n'importe quel événement
  const s = await sessionCodex(false, 'PreToolUse');
  try {
    // Act
    await ensureTranscriptWatcher(s.evenements);
    // Assert
    const snap = tokensSnapshot(s.rec)!;
    expect(snap.tokensSupported).toBe(true);
    expect(tokenSum(snap.main)).toBe(P1.total_tokens);
    expect(tokenSum(snap.perAgent[ENFANT])).toBe(A1.total_tokens);
  } finally {
    await s.fin();
  }
});

test('Codex : avec un sous-agent en tête du fichier d’événements, la question de la session est celle du fil principal', async () => {
  // Arrange
  const s = await sessionCodex(false, 'PreToolUse');
  try {
    // Act
    const trouvee = await ensureFirstPrompt(s.evenements);
    // Assert
    expect(trouvee).toBe('question du fil principal');
  } finally {
    await s.fin();
  }
});

test('Claude Code : un événement de sous-agent en tête porte le transcript du fil principal, qui reste lu', async () => {
  // Arrange
  const s = await session('claude');
  await ecrireJsonl(s.parent, [{
    type: 'assistant', isSidechain: false,
    message: { model: 'claude-sonnet-4-5', usage: { input_tokens: 1234, output_tokens: 10 } },
  }]);
  await ecrireJsonl(s.evenements, [
    evenement('claude', 'PreToolUse', s.parent, ENFANT),
    evenement('claude', 'UserPromptSubmit', s.parent),
  ]);
  try {
    // Act
    await ensureTranscriptWatcher(s.evenements);
    // Assert
    const snap = tokensSnapshot(s.rec)!;
    expect(snap.tokensSupported).toBe(true);
    expect(snap.main.in).toBe(1234);
  } finally {
    await s.fin();
  }
});

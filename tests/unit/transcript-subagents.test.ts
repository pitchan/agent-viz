// Integration: sub-agent transcript discovery + tailing.
//
// Claude Code ≥ ~2.1.143 writes each sub-agent's transcript to a sibling file
// <session>/subagents/agent-<id>.jsonl instead of inlining agent_progress
// events in the parent transcript. ensureSubagentTails must find those files,
// stream them, and credit usage to the matching perAgent bucket.

import { expect, test } from 'vitest';
import fs from 'node:fs';
const fsp = fs.promises;
import path from 'node:path';
import os from 'node:os';

import { _internals } from '../../src/server/transcript.ts';
import { ensureTokens, clearTokensTimer } from '../../src/server/tokens.ts';
import type { SessionRecord } from '../../src/server/session-index.ts';

const { ensureTranscriptSlice, makeTail, ensureSubagentTails } = _internals;

// Fixture partielle : `transcript`/`tokens` sont les tranches que
// transcript.ts/tokens.ts posent eux-mêmes sur l'enregistrement, pas ce que
// session-index.ts connaît — `any` ici, jamais un `SessionRecord` complet.
type RecFixture = SessionRecord & { transcript: any; tokens: any };
type Tranche = ReturnType<typeof ensureTranscriptSlice>;

function assistantLine(agentId: string, model: string, inTok: number, outTok: number) {
  return JSON.stringify({
    type: 'assistant', isSidechain: true, agentId,
    message: { model, usage: { input_tokens: inTok, output_tokens: outTok } },
  }) + '\n';
}

// Build a temp session: an (empty) main transcript file + a subagents/ dir.
async function tmpSession() {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'aviz-sub-'));
  const mainPath = path.join(dir, 'sess-1.jsonl');
  await fsp.writeFile(mainPath, '');
  const subDir = path.join(dir, 'sess-1', 'subagents');
  return { dir, mainPath, subDir };
}

function freshRec(): { rec: RecFixture; tr: Tranche } {
  const rec = { id: 'sess-1', tokens: null } as unknown as RecFixture;
  ensureTokens(rec);
  const tr = ensureTranscriptSlice(rec);
  return { rec, tr };
}

function cleanup(rec: RecFixture, tr: Tranche, dir: string) {
  if (tr.main && tr.main.watcher) { try { tr.main.watcher.close(); } catch {} }
  for (const t of tr.subagents.values()) { if (t.watcher) { try { t.watcher.close(); } catch {} } }
  clearTokensTimer(rec);
  return fsp.rm(dir, { recursive: true, force: true });
}

test('ensureSubagentTails discovers agent-*.jsonl and credits perAgent buckets', async () => {
  const { dir, mainPath, subDir } = await tmpSession();
  await fsp.mkdir(subDir, { recursive: true });
  await fsp.writeFile(path.join(subDir, 'agent-AAA.jsonl'),
    assistantLine('AAA', 'claude-haiku-4-5', 2000, 100));

  const { rec, tr } = freshRec();
  tr.main = makeTail(mainPath);

  await ensureSubagentTails(tr, rec);

  const bucket = rec.tokens.perAgent.get('AAA');
  expect(bucket, 'perAgent bucket for AAA must exist').toBeTruthy();
  expect(bucket.in).toBe(2000);
  expect(bucket.out).toBe(100);
  expect(bucket.lastModel).toBe('claude-haiku-4-5');

  await cleanup(rec, tr, dir);
});

test('ensureSubagentTails is idempotent — re-scan does not double-count', async () => {
  const { dir, mainPath, subDir } = await tmpSession();
  await fsp.mkdir(subDir, { recursive: true });
  await fsp.writeFile(path.join(subDir, 'agent-AAA.jsonl'),
    assistantLine('AAA', 'claude-haiku-4-5', 2000, 100));

  const { rec, tr } = freshRec();
  tr.main = makeTail(mainPath);

  await ensureSubagentTails(tr, rec);
  await ensureSubagentTails(tr, rec);

  expect(rec.tokens.perAgent.get('AAA').in, 'tokens must not be counted twice').toBe(2000);
  expect(tr.subagents.size).toBe(1);

  await cleanup(rec, tr, dir);
});

test('ensureSubagentTails picks up a sub-agent file that appears on a later scan', async () => {
  const { dir, mainPath, subDir } = await tmpSession();
  await fsp.mkdir(subDir, { recursive: true });
  await fsp.writeFile(path.join(subDir, 'agent-AAA.jsonl'),
    assistantLine('AAA', 'claude-haiku-4-5', 1000, 0));

  const { rec, tr } = freshRec();
  tr.main = makeTail(mainPath);
  await ensureSubagentTails(tr, rec);

  // A second sub-agent is spawned mid-session.
  await fsp.writeFile(path.join(subDir, 'agent-BBB.jsonl'),
    assistantLine('BBB', 'claude-sonnet-4-5', 500, 200));
  await ensureSubagentTails(tr, rec);

  expect(rec.tokens.perAgent.get('AAA').in).toBe(1000);
  expect(rec.tokens.perAgent.get('BBB').in).toBe(500);
  expect(tr.subagents.size).toBe(2);

  await cleanup(rec, tr, dir);
});

test('ensureSubagentTails is a no-op when there is no subagents/ directory', async () => {
  const { dir, mainPath } = await tmpSession();

  const { rec, tr } = freshRec();
  tr.main = makeTail(mainPath);

  await ensureSubagentTails(tr, rec);

  expect(tr.subagents.size).toBe(0);
  expect(rec.tokens.perAgent.size).toBe(0);

  await cleanup(rec, tr, dir);
});

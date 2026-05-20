'use strict';
// Integration: sub-agent transcript discovery + tailing.
//
// Claude Code ≥ ~2.1.143 writes each sub-agent's transcript to a sibling file
// <session>/subagents/agent-<id>.jsonl instead of inlining agent_progress
// events in the parent transcript. ensureSubagentTails must find those files,
// stream them, and credit usage to the matching perAgent bucket.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');

const { _internals } = require('../../lib/server/transcript');
const { ensureTokens, clearTokensTimer } = require('../../lib/server/tokens');

const { ensureTranscriptSlice, makeTail, ensureSubagentTails } = _internals;

function assistantLine(agentId, model, inTok, outTok) {
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

function freshRec() {
  const rec = { id: 'sess-1', tokens: null };
  ensureTokens(rec);
  const tr = ensureTranscriptSlice(rec);
  return { rec, tr };
}

function cleanup(rec, tr, dir) {
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
  assert.ok(bucket, 'perAgent bucket for AAA must exist');
  assert.equal(bucket.in, 2000);
  assert.equal(bucket.out, 100);
  assert.equal(bucket.lastModel, 'claude-haiku-4-5');

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

  assert.equal(rec.tokens.perAgent.get('AAA').in, 2000, 'tokens must not be counted twice');
  assert.equal(tr.subagents.size, 1);

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

  assert.equal(rec.tokens.perAgent.get('AAA').in, 1000);
  assert.equal(rec.tokens.perAgent.get('BBB').in, 500);
  assert.equal(tr.subagents.size, 2);

  await cleanup(rec, tr, dir);
});

test('ensureSubagentTails is a no-op when there is no subagents/ directory', async () => {
  const { dir, mainPath } = await tmpSession();

  const { rec, tr } = freshRec();
  tr.main = makeTail(mainPath);

  await ensureSubagentTails(tr, rec);

  assert.equal(tr.subagents.size, 0);
  assert.equal(rec.tokens.perAgent.size, 0);

  await cleanup(rec, tr, dir);
});

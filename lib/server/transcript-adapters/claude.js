'use strict';
// Claude Code transcript adapter.
//
// Discovery: Claude Code stamps `transcript_path` on every hook event,
// including SessionStart. So pulling it from the first event works.
//
// Schema — three line shapes carry token usage:
//   - main thread: assistant lines with `isSidechain:false`, usage at
//     `evt.message.usage`.
//   - sub-agent (Claude Code ≥ ~2.1.143): each sub-agent gets its own
//     transcript file (<session>/subagents/agent-<id>.jsonl); its assistant
//     lines carry `isSidechain:true` + a top-level `agentId`, usage at
//     `evt.message.usage` (same shape as the main thread).
//   - sub-agent (legacy, Claude Code ≤ ~2.1.81): activity streamed inline in
//     the parent transcript as `agent_progress` events, usage nested at
//     `evt.data.message.message.usage`.

const { ensureTokens, accumulateUsage, newBucket } = require('../tokens');

function discoverPath(firstEvent) {
  return (firstEvent && firstEvent.transcript_path) || null;
}

function parseUsageLine(line, rec) {
  if (!line || line.indexOf('"usage"') === -1) return false;
  let evt;
  try { evt = JSON.parse(line); } catch { return false; }
  let usage = null, key = null, model = null, msgId = null;
  // Anthropic message id — single source of truth for dedup. Claude Code
  // splits one API message into one JSONL line per content block (thinking,
  // text, tool_use), each carrying the SAME usage object; without dedup the
  // bucket sums the same usage N times. The id lives at `message.id` in all
  // three modern shapes and at `data.message.message.id` for legacy progress.
  if (evt.isSidechain === false && evt.type === 'assistant'
      && evt.message && evt.message.usage) {
    usage = evt.message.usage;
    model = evt.message.model || null;
    msgId = evt.message.id || null;
    key = '__main__';
  } else if (evt.isSidechain === true && evt.type === 'assistant'
      && evt.agentId && evt.message && evt.message.usage) {
    usage = evt.message.usage;
    model = evt.message.model || null;
    msgId = evt.message.id || null;
    key = evt.agentId;
  } else if (evt.type === 'progress' && evt.data
      && evt.data.type === 'agent_progress' && evt.data.agentId
      && evt.data.message && evt.data.message.message && evt.data.message.message.usage) {
    usage = evt.data.message.message.usage;
    model = evt.data.message.message.model || null;
    msgId = evt.data.message.message.id || null;
    key = evt.data.agentId;
  }
  if (!usage) return false;
  ensureTokens(rec);
  let bucket;
  if (key === '__main__') {
    bucket = rec.tokens.main;
  } else {
    bucket = rec.tokens.perAgent.get(key);
    if (!bucket) {
      bucket = newBucket();
      rec.tokens.perAgent.set(key, bucket);
    }
  }
  accumulateUsage(bucket, usage, model, msgId);
  return true;
}

module.exports = {
  tokensSupported: true,
  discoverPath,
  parseUsageLine,
};

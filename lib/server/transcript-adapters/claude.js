'use strict';
// Claude Code transcript adapter.
//
// Discovery: Claude Code stamps `transcript_path` on every hook event,
// including SessionStart. So pulling it from the first event works.
//
// Schema: assistant lines on the main thread carry usage at
// `evt.message.usage`; sub-agent progress events nest it at
// `evt.data.message.message.usage`. Both populate model and token counts.

const { ensureTokens, accumulateUsage, newBucket } = require('../tokens');

function discoverPath(firstEvent) {
  return (firstEvent && firstEvent.transcript_path) || null;
}

function parseUsageLine(line, rec) {
  if (!line || line.indexOf('"usage"') === -1) return false;
  let evt;
  try { evt = JSON.parse(line); } catch { return false; }
  let usage = null, key = null, model = null;
  if (evt.isSidechain === false && evt.type === 'assistant'
      && evt.message && evt.message.usage) {
    usage = evt.message.usage;
    model = evt.message.model || null;
    key = '__main__';
  } else if (evt.type === 'progress' && evt.data
      && evt.data.type === 'agent_progress' && evt.data.agentId
      && evt.data.message && evt.data.message.message && evt.data.message.message.usage) {
    usage = evt.data.message.message.usage;
    model = evt.data.message.message.model || null;
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
  accumulateUsage(bucket, usage, model);
  return true;
}

module.exports = {
  tokensSupported: true,
  discoverPath,
  parseUsageLine,
};

'use strict';
// Adapter registry. Pattern follows lib/server/routes.js — declarative
// dispatch table keyed by session._source. Liskov contract enforced by
// the test suite, not by inheritance.

const claude = require('./claude');
const copilot = require('./copilot');

const TRANSCRIPT_ADAPTERS = { claude, copilot };

// Pre-0.2.0 hooks did not stamp _source; null/undefined defaults to claude
// (the historical producer). An unknown string means a new agent source
// landed in the hook layer without a matching adapter — that's a bug we want
// surfaced, not silently absorbed, but not severe enough to crash the whole
// transcript pipeline (which would take down all sessions).
function getAdapter(agentSource) {
  if (agentSource == null) return TRANSCRIPT_ADAPTERS.claude;
  if (Object.hasOwn(TRANSCRIPT_ADAPTERS, agentSource)) {
    return TRANSCRIPT_ADAPTERS[agentSource];
  }
  console.error(`[transcript-adapters] unknown agentSource "${agentSource}" — using claude as a fallback. Add an adapter under lib/server/transcript-adapters/.`);
  return TRANSCRIPT_ADAPTERS.claude;
}

module.exports = { TRANSCRIPT_ADAPTERS, getAdapter };

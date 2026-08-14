'use strict';
// Adapter registry. Pattern follows src/server/routes.js — declarative
// dispatch table keyed by session._source. Liskov contract enforced by
// the test suite, not by inheritance.

import * as claude from './claude.ts';
import * as copilot from './copilot.ts';

const TRANSCRIPT_ADAPTERS = { claude, copilot };

// Garde de type sur les clés réelles du registre — vit ici, à côté de la
// constante qu'elle protège, plutôt qu'un cast : `Object.hasOwn` seul ne
// rétrécit pas `agentSource` vers `keyof typeof TRANSCRIPT_ADAPTERS`.
function isAdapterKey(key: string): key is keyof typeof TRANSCRIPT_ADAPTERS {
  return Object.hasOwn(TRANSCRIPT_ADAPTERS, key);
}

// Pre-0.2.0 hooks did not stamp _source; null/undefined defaults to claude
// (the historical producer). An unknown string means a new agent source
// landed in the hook layer without a matching adapter — that's a bug we want
// surfaced, not silently absorbed, but not severe enough to crash the whole
// transcript pipeline (which would take down all sessions).
//
// `agentSource` arrive d'un JSONL non typé (`evt._source` / `rec.agentSource`
// dans transcript.ts, hors lot) : `unknown`, pas `string`, jusqu'à preuve du
// contraire.
function getAdapter(agentSource: unknown) {
  if (agentSource == null) return TRANSCRIPT_ADAPTERS.claude;
  if (typeof agentSource === 'string' && isAdapterKey(agentSource)) {
    return TRANSCRIPT_ADAPTERS[agentSource];
  }
  console.error(`[transcript-adapters] unknown agentSource "${String(agentSource)}" — using claude as a fallback. Add an adapter under src/server/transcript-adapters/.`);
  return TRANSCRIPT_ADAPTERS.claude;
}

export { TRANSCRIPT_ADAPTERS, getAdapter };

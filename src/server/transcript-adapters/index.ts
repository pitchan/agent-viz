'use strict';
// Adapter registry. Pattern follows src/server/routes.ts — declarative
// dispatch table keyed by session._source. Liskov contract enforced by
// the test suite, not by inheritance.

import * as claude from './claude.ts';
import * as copilot from './copilot.ts';
import * as antigravity from './antigravity.ts';
import type { TranscriptAdapter } from './types.ts';

const TRANSCRIPT_ADAPTERS = { claude, copilot, antigravity } satisfies Record<string, TranscriptAdapter>;

// Garde de type sur les clés réelles du registre — vit ici, à côté de la
// constante qu'elle protège, plutôt qu'un cast : `Object.hasOwn` seul ne
// rétrécit pas `agentSource` vers `keyof typeof TRANSCRIPT_ADAPTERS`.
function isAdapterKey(key: string): key is keyof typeof TRANSCRIPT_ADAPTERS {
  return Object.hasOwn(TRANSCRIPT_ADAPTERS, key);
}

// Une source inconnue n'a aucun format connu : la lire avec le lecteur de Claude compterait
// le transcript d'un autre agent comme le sien. Rien n'est lu, l'interface affiche « Tokens N/A ».
const UNKNOWN_SOURCE: TranscriptAdapter = {
  tokensSupported: false,
  discoverPath: () => null,
  extractPrompt: () => null,
  parseUsageLine: () => false,
  usageSnapshot: null,
};

const reportedUnknownSources = new Set<string>();

// An event without _source (null/undefined: its hook did not stamp one)
// defaults to claude, the historical producer. An unknown string means a new
// agent source landed in the hook layer without a matching adapter — that's a
// bug we want surfaced once per source, not on every transcript line.
//
// `agentSource` arrive d'un JSONL non typé (`evt._source` / `rec.agentSource`
// dans transcript.ts) : `unknown`, pas `string`, jusqu'à preuve du contraire.
function getAdapter(agentSource: unknown): TranscriptAdapter {
  if (agentSource == null) return TRANSCRIPT_ADAPTERS.claude;
  if (typeof agentSource === 'string' && isAdapterKey(agentSource)) {
    return TRANSCRIPT_ADAPTERS[agentSource];
  }
  const name = String(agentSource);
  if (!reportedUnknownSources.has(name)) {
    reportedUnknownSources.add(name);
    console.error(`[transcript-adapters] unknown agentSource "${name}" — its transcript is not read. Add an adapter under src/server/transcript-adapters/.`);
  }
  return UNKNOWN_SOURCE;
}

export { TRANSCRIPT_ADAPTERS, getAdapter };

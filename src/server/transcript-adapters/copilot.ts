'use strict';
// Copilot does not expose per-message token usage in its transcript JSONL
// or CLI hook payloads. Treated as unsupported — UI shows "Tokens N/A"
// rather than a silently-zero gauge.

import type { UsageRecord } from './claude.ts';

// Mêmes types de paramètres que `claude.ts`, volontairement : c'est le
// contrat de Liskov que `index.ts` documente et que le test
// (`transcript-adapters.test.cjs`) vérifie à l'exécution — deux adaptateurs
// interchangeables, jamais deux formes d'appel.
function discoverPath(_firstEvent: unknown): null { return null; }
function parseUsageLine(_line: string, _rec: UsageRecord): false { return false; }

const tokensSupported = false;

export {
  tokensSupported,
  discoverPath,
  parseUsageLine,
};

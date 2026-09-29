'use strict';
// Les jetons d'Antigravity ne sont ni dans les charges de hook ni lus ici : l'interface
// affiche « Tokens N/A » plutôt qu'une jauge à zéro. Même contrat que copilot.ts.

import type { UsageRecord } from './claude.ts';

function discoverPath(_firstEvent: unknown): null { return null; }
function parseUsageLine(_line: string, _rec: UsageRecord): false { return false; }

const tokensSupported = false;

export {
  tokensSupported,
  discoverPath,
  parseUsageLine,
};

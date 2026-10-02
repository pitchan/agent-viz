'use strict';
// Adaptateur Antigravity CLI. Le transcript porte la question de l'utilisateur ; les jetons
// n'y sont pas, ils sont relus dans la base de la conversation (antigravity-db.ts).

import { decodeJsonlLine } from '../../engine/core/jsonl.ts';
import { antigravityUsageSnapshot } from './antigravity-db.ts';
import type { UsageRecord } from './claude.ts';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function discoverPath(firstEvent: unknown): string | null {
  if (!isRecord(firstEvent)) return null;
  return typeof firstEvent.transcript_path === 'string' ? firstEvent.transcript_path : null;
}

// agy enveloppe la question dans <USER_REQUEST> et la fait suivre de métadonnées :
// sans cette enveloppe, rien n'est rendu plutôt que le contenu brut.
const USER_REQUEST = /<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/;

function extractPrompt(text: string): string | null {
  for (const line of text.split('\n')) {
    const verdict = decodeJsonlLine(line);
    if (!verdict || !verdict.ok || !isRecord(verdict.value)) continue;
    const entry = verdict.value;
    if (entry.type !== 'USER_INPUT' || typeof entry.content !== 'string') continue;
    const prompt = USER_REQUEST.exec(entry.content)?.[1]?.trim();
    if (prompt) return prompt.slice(0, 120);
  }
  return null;
}

function parseUsageLine(_line: string, _rec: UsageRecord): false { return false; }

const tokensSupported = true;
const usageSnapshot = antigravityUsageSnapshot;

export {
  tokensSupported,
  discoverPath,
  extractPrompt,
  parseUsageLine,
  usageSnapshot,
};

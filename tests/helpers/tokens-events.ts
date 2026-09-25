// Fabrique d'événement `assistant` pour les filets de TokensAggregator : un défaut
// valide, chaque test ne déclare que ce qui diffère (`tests/CLAUDE.md` § 2).
import type { NormalizedEvent, RawUsage } from '../../src/engine/core/events.ts';
import type { UsageVerdict } from '../../src/engine/core/usage.ts';

export function assistant(over: {
  msgId?: string | null;
  model?: string;
  usage?: RawUsage;
  usageVerdict?: UsageVerdict;
  timestamp?: string;
}): Extract<NormalizedEvent, { kind: 'assistant' }> {
  return {
    kind: 'assistant',
    msgId: over.msgId === undefined ? 'msg_x' : over.msgId,
    model: over.model ?? 'claude-opus-4-8',
    usage: over.usage ?? { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    usageVerdict: over.usageVerdict ?? 'sain',
    toolUses: [],
    textChars: 0,
    ...(over.timestamp !== undefined ? { timestamp: over.timestamp } : {}),
    isSidechain: false,
  };
}


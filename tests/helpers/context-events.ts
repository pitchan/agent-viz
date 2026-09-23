// Fabrique d'événement `assistant` normalisé pour les filets de ContextAggregator :
// un défaut valide, chaque test ne déclare que ce qui diffère (`tests/CLAUDE.md` § 2).
import type { NormalizedEvent, RawUsage, ToolUseRef } from '../../src/engine/core/events.ts';
import type { UsageVerdict } from '../../src/engine/core/usage.ts';

export function assistant(
  msgId: string,
  usage: RawUsage,
  timestamp?: string,
  opts?: { model?: string | null; toolUses?: ToolUseRef[]; cacheMissReason?: string; usageVerdict?: UsageVerdict },
): Extract<NormalizedEvent, { kind: 'assistant' }> {
  return {
    kind: 'assistant',
    msgId,
    model: opts?.model !== undefined ? opts.model : 'claude-opus-4-8',
    usage,
    usageVerdict: opts?.usageVerdict ?? 'sain',
    toolUses: opts?.toolUses ?? [],
    textChars: 0,
    ...(timestamp !== undefined ? { timestamp } : {}),
    ...(opts?.cacheMissReason !== undefined ? { cacheMissReason: opts.cacheMissReason } : {}),
    isSidechain: false,
  };
}

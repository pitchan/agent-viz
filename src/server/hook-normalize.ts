// Ramène la charge brute d'un agent à la forme canonique que lisent tous les
// consommateurs d'agent-events/*.jsonl : le vocabulaire de Claude Code. Pur : hook.ts
// garde l'I/O, un agent de plus = une entrée de table, sans toucher aux lecteurs.

export type HookSource = 'claude' | 'copilot' | 'antigravity';
export const HOOK_SOURCES: readonly HookSource[] = ['claude', 'copilot', 'antigravity'];

type Payload = Record<string, unknown>;
type Normalizer = (raw: Payload, event: string | undefined) => Payload;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const identity: Normalizer = (raw) => raw;

// La charge d'agy ne nomme pas son événement : la commande installée le passe en
// --event. `stepIdx` relie un PreToolUse à son PostToolUse ; préfixé de la
// conversation, car les nœuds de la vue sont indexés `t:<id>` toutes sessions confondues.
function normalizeAntigravity(raw: Payload, event: string | undefined): Payload {
  const out: Payload = { ...raw, _native_event: event };
  const conv = raw.conversationId;
  if (typeof conv === 'string') out.session_id = conv;
  const error = typeof raw.error === 'string' ? raw.error : '';
  out.hook_event_name = event === 'PostToolUse' && error !== '' ? 'PostToolUseFailure' : event;
  if (isRecord(raw.toolCall)) {
    out.tool_name = raw.toolCall.name;
    out.tool_input = raw.toolCall.args;
  }
  if (typeof conv === 'string' && typeof raw.stepIdx === 'number') out.tool_use_id = `${conv}:${raw.stepIdx}`;
  const first = Array.isArray(raw.workspacePaths) ? raw.workspacePaths[0] : undefined;
  if (typeof first === 'string') out.cwd = first;
  if (typeof raw.transcriptPath === 'string') out.transcript_path = raw.transcriptPath;
  return out;
}

export const NORMALIZERS: Record<HookSource, Normalizer> = {
  claude: identity,
  copilot: identity,
  antigravity: normalizeAntigravity,
};

// Une source dont la charge ne nomme pas l'événement ne peut pas être lue sans --event.
export const NEEDS_EVENT_FLAG: Record<HookSource, boolean> = {
  claude: false,
  copilot: false,
  antigravity: true,
};

// Ramène la charge brute d'un agent à la forme canonique que lisent tous les
// consommateurs d'agent-events/*.jsonl : le vocabulaire de Claude Code. Pur : hook.ts
// garde l'I/O, un agent de plus = une entrée de table, sans toucher aux lecteurs.

// Import de type seul : effacé à la compilation, il n'ajoute aucun chargement au hook.
import type { AgentName } from './install-hooks/types.ts';

export type HookSource = AgentName;

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

// Codex colle l'espace de noms d'un outil à son nom dans `tool_name` ; sa transcription
// les garde séparés. Chaque groupe dit ce qui remplace son préfixe : `run` seul ne dirait
// pas qu'il touche au web. Ceux d'MCP finissent par `__` et donnent déjà `mcp__<serveur>__<outil>`.
const CODEX_GLUED_NAMESPACES: Record<string, string> = {
  collaboration: '',
  web: 'web.',
};

function normalizeCodex(raw: Payload): Payload {
  const name = raw.tool_name;
  if (typeof name !== 'string') return raw;
  const ns = Object.keys(CODEX_GLUED_NAMESPACES).find(prefix => name.length > prefix.length && name.startsWith(prefix));
  return ns === undefined ? raw : { ...raw, tool_name: CODEX_GLUED_NAMESPACES[ns] + name.slice(ns.length) };
}

export const NORMALIZERS: Record<HookSource, Normalizer> = {
  claude: identity,
  copilot: identity,
  antigravity: normalizeAntigravity,
  codex: normalizeCodex,
};

// Lue des clefs d'une table `Record<HookSource, …>` : un agent oublié ici ne compile pas.
export const HOOK_SOURCES = Object.keys(NORMALIZERS) as readonly HookSource[];

// Une source dont la charge ne nomme pas l'événement ne peut pas être lue sans --event.
export const NEEDS_EVENT_FLAG: Record<HookSource, boolean> = {
  claude: false,
  copilot: false,
  antigravity: true,
  codex: false,
};

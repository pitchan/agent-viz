import { createHash } from 'node:crypto';

export interface RawUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation?: {
    ephemeral_5m_input_tokens?: number;
    ephemeral_1h_input_tokens?: number;
  };
}

export interface ToolUseRef {
  id: string;
  name: string;
  input: unknown;
}

export type NormalizedEvent =
  | {
      kind: 'assistant';
      msgId: string | null;
      model: string | null;
      usage: RawUsage | null;
      toolUses: ToolUseRef[];
      textChars: number;
      timestamp?: string;
      agentId?: string;
      isSidechain: boolean;
    }
  | { kind: 'tool_result'; toolUseId: string; bytes: number; isError: boolean; contentHash: string | null; timestamp?: string }
  | {
      kind: 'user_prompt';
      text: string;
      shape: 'string' | 'blocks';
      promptSource?: string;
      originKind?: string;
      timestamp?: string;
    }
  | { kind: 'compact'; trigger: 'auto' | 'manual'; preTokens: number | null }
  | { kind: 'meta' }
  | { kind: 'other'; topLevelType: string };

export interface LineMeta {
  cwd?: string;
  version?: string;
  gitBranch?: string;
}

type Rec = Record<string, unknown>;

function asRec(v: unknown): Rec | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Rec) : null;
}

function asStr(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

/**
 * Normalise une ligne brute de transcript en 0..n événements typés.
 * Ne throw jamais : toute forme inconnue devient { kind: 'other' } et
 * sera comptée par le scanner (visibilité sans crash).
 */
export function normalizeEvent(raw: unknown): NormalizedEvent[] {
  const line = asRec(raw);
  if (line === null) return [{ kind: 'other', topLevelType: 'invalid' }];
  const type = asStr(line['type']);
  if (type === 'assistant') return [normalizeAssistant(line)];
  if (type === 'user') return normalizeUser(line);
  if (type === 'system' && line['subtype'] === 'compact_boundary') return [normalizeCompact(line)];
  if (type === null) return [{ kind: 'other', topLevelType: 'unknown' }];
  return [{ kind: 'other', topLevelType: type }];
}

function normalizeAssistant(line: Rec): NormalizedEvent {
  const message = asRec(line['message']) ?? {};
  const content = Array.isArray(message['content']) ? message['content'] : [];
  const toolUses: ToolUseRef[] = [];
  let textChars = 0;
  for (const rawBlock of content) {
    const block = asRec(rawBlock);
    if (block === null) continue;
    if (block['type'] === 'tool_use') {
      const id = asStr(block['id']);
      const name = asStr(block['name']);
      if (id !== null && name !== null) toolUses.push({ id, name, input: block['input'] });
    } else if (block['type'] === 'text') {
      textChars += asStr(block['text'])?.length ?? 0;
    }
  }
  const timestamp = asStr(line['timestamp']);
  const agentId = asStr(line['agentId']);
  return {
    kind: 'assistant',
    msgId: asStr(message['id']),
    model: asStr(message['model']),
    usage: asRec(message['usage']) as RawUsage | null,
    toolUses,
    textChars,
    ...(timestamp !== null ? { timestamp } : {}),
    ...(agentId !== null ? { agentId } : {}),
    isSidechain: line['isSidechain'] === true,
  };
}

function normalizeUser(line: Rec): NormalizedEvent[] {
  if (line['isMeta'] === true) return [{ kind: 'meta' }];
  const message = asRec(line['message']) ?? {};
  const content = message['content'];
  const timestamp = asStr(line['timestamp']);
  const ts = timestamp !== null ? { timestamp } : {};
  const promptSource = asStr(line['promptSource']);
  const origin = asRec(line['origin']);
  const originKind = origin === null ? null : asStr(origin['kind']);
  const marks = {
    ...(promptSource !== null ? { promptSource } : {}),
    ...(originKind !== null ? { originKind } : {}),
  };

  if (typeof content === 'string') {
    return [{ kind: 'user_prompt', text: content, shape: 'string', ...marks, ...ts }];
  }
  if (!Array.isArray(content)) return [];

  const toolResults: NormalizedEvent[] = [];
  const texts: string[] = [];
  for (const rawBlock of content) {
    const block = asRec(rawBlock);
    if (block === null) continue;
    if (block['type'] === 'tool_result') {
      const toolUseId = asStr(block['tool_use_id']);
      if (toolUseId === null) continue;
      toolResults.push({
        kind: 'tool_result',
        toolUseId,
        bytes: toolResultBytes(block['content']),
        isError: block['is_error'] === true,
        contentHash: toolResultHash(block['content']),
        ...ts,
      });
    } else if (block['type'] === 'text') {
      const text = asStr(block['text']);
      if (text !== null) texts.push(text);
    }
  }
  if (toolResults.length > 0) return toolResults;
  if (texts.length > 0) return [{ kind: 'user_prompt', text: texts.join('\n'), shape: 'blocks', ...marks, ...ts }];
  return [];
}

/**
 * Empreinte sha1 du même texte que toolResultBytes (le dédoublonnage des lectures
 * en dépend : même texte → même empreinte) ; null si vide — le texte n'est jamais conservé.
 */
export function toolResultHash(content: unknown): string | null {
  let text: string;
  if (typeof content === 'string') {
    text = content;
  } else if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const rawBlock of content) {
      const block = asRec(rawBlock);
      if (block === null) continue;
      const t = asStr(block['text']);
      if (t !== null) parts.push(t);
    }
    text = parts.join('');
  } else {
    return null;
  }
  if (text.length === 0) return null;
  return createHash('sha1').update(text, 'utf8').digest('hex');
}

/** Octets UTF-8 du contenu d'un tool_result tel qu'inséré au contexte (string ou array de blocks). */
export function toolResultBytes(content: unknown): number {
  if (typeof content === 'string') return Buffer.byteLength(content, 'utf8');
  if (!Array.isArray(content)) return 0;
  let bytes = 0;
  for (const rawBlock of content) {
    const block = asRec(rawBlock);
    if (block === null) continue;
    const text = asStr(block['text']);
    if (text !== null) bytes += Buffer.byteLength(text, 'utf8');
  }
  return bytes;
}

function normalizeCompact(line: Rec): NormalizedEvent {
  const meta = asRec(line['compactMetadata']) ?? {};
  const preTokens = typeof meta['preTokens'] === 'number' ? meta['preTokens'] : null;
  return {
    kind: 'compact',
    trigger: meta['trigger'] === 'manual' ? 'manual' : 'auto',
    preTokens,
  };
}

export function extractLineMeta(raw: unknown): LineMeta {
  const line = asRec(raw);
  if (line === null) return {};
  const meta: LineMeta = {};
  const cwd = asStr(line['cwd']);
  const version = asStr(line['version']);
  const gitBranch = asStr(line['gitBranch']);
  if (cwd !== null) meta.cwd = cwd;
  if (version !== null) meta.version = version;
  if (gitBranch !== null) meta.gitBranch = gitBranch;
  return meta;
}

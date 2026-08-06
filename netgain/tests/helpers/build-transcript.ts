import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export interface LineOpts {
  timestamp?: string;
  cwd?: string;
  version?: string;
  gitBranch?: string;
  isSidechain?: boolean;
  agentId?: string;
  isMeta?: boolean;
  promptSource?: string;
  origin?: Record<string, unknown>;
}

function base(o: LineOpts): Record<string, unknown> {
  const b: Record<string, unknown> = {};
  if (o.timestamp !== undefined) b['timestamp'] = o.timestamp;
  if (o.cwd !== undefined) b['cwd'] = o.cwd;
  if (o.version !== undefined) b['version'] = o.version;
  if (o.gitBranch !== undefined) b['gitBranch'] = o.gitBranch;
  if (o.isSidechain !== undefined) b['isSidechain'] = o.isSidechain;
  if (o.agentId !== undefined) b['agentId'] = o.agentId;
  if (o.isMeta !== undefined) b['isMeta'] = o.isMeta;
  if (o.promptSource !== undefined) b['promptSource'] = o.promptSource;
  if (o.origin !== undefined) b['origin'] = o.origin;
  return b;
}

export function toolUse(id: string, name: string, input: unknown): Record<string, unknown> {
  return { type: 'tool_use', id, name, input };
}

export function textBlock(text: string): Record<string, unknown> {
  return { type: 'text', text };
}

export function assistantLine(
  o: { msgId: string | null; model?: string; usage?: Record<string, unknown> | null; content?: unknown[] } & LineOpts,
): string {
  const message: Record<string, unknown> = { role: 'assistant', content: o.content ?? [] };
  if (o.msgId !== null) message['id'] = o.msgId;
  if (o.model !== undefined) message['model'] = o.model;
  if (o.usage !== undefined && o.usage !== null) message['usage'] = o.usage;
  return JSON.stringify({ type: 'assistant', message, ...base(o) });
}

export function toolResultLine(toolUseId: string, content: unknown, o: LineOpts & { isError?: boolean } = {}): string {
  const block: Record<string, unknown> = { type: 'tool_result', tool_use_id: toolUseId, content };
  if (o.isError !== undefined) block['is_error'] = o.isError;
  return JSON.stringify({ type: 'user', message: { role: 'user', content: [block] }, ...base(o) });
}

export function promptLine(text: string, o: LineOpts = {}): string {
  return JSON.stringify({ type: 'user', message: { role: 'user', content: text }, ...base(o) });
}

/** Prompt utilisateur de forme interactive : un tableau de blocs [{type:'text'}]. */
export function promptBlocksLine(text: string, o: LineOpts = {}): string {
  return JSON.stringify({
    type: 'user',
    message: { role: 'user', content: [{ type: 'text', text }] },
    ...base(o),
  });
}

export function compactLine(trigger: 'auto' | 'manual', preTokens: number | null, o: LineOpts = {}): string {
  return JSON.stringify({ type: 'system', subtype: 'compact_boundary', compactMetadata: { trigger, preTokens }, ...base(o) });
}

export interface SubagentSpec {
  agentId: string;
  lines: string[];
  meta?: Record<string, unknown>;
}

/** Écrit un arbre imitant ~/.claude/projects : <slug>/<sessionId>.jsonl + subagents/. */
export function writeSessionTree(
  claudeDir: string,
  projectSlug: string,
  sessionId: string,
  mainLines: string[],
  subagents: SubagentSpec[] = [],
): void {
  const projDir = path.join(claudeDir, 'projects', projectSlug);
  mkdirSync(projDir, { recursive: true });
  writeFileSync(path.join(projDir, `${sessionId}.jsonl`), `${mainLines.join('\n')}\n`);
  for (const sub of subagents) {
    const subDir = path.join(projDir, sessionId, 'subagents');
    mkdirSync(subDir, { recursive: true });
    writeFileSync(path.join(subDir, `agent-${sub.agentId}.jsonl`), `${sub.lines.join('\n')}\n`);
    if (sub.meta !== undefined) {
      writeFileSync(path.join(subDir, `agent-${sub.agentId}.meta.json`), JSON.stringify(sub.meta));
    }
  }
}

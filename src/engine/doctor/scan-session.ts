import { readFile } from 'node:fs/promises';
import type { SessionRef } from '../core/discovery.js';
import { extractLineMeta, normalizeEvent } from '../core/events.js';
import { iterJsonlLines } from '../core/jsonl.js';
import { ContextAggregator } from './aggregators/context.js';
import { SessionClock } from './aggregators/clock.js';
import { PromptsAggregator } from './aggregators/prompts.js';
import { ReadsAggregator } from './aggregators/reads.js';
import { SessionKindAggregator } from './aggregators/session-kind.js';
import { SubagentsAggregator } from './aggregators/subagents.js';
import { netTokens, TokensAggregator } from './aggregators/tokens.js';
import { ToolResultsAggregator } from './aggregators/tool-results.js';
import { TurnsAggregator } from './aggregators/turns.js';
import type { SessionReport } from './report/types.js';

/**
 * Une passe streaming sur le transcript principal + une par sous-agent.
 * Mémoire O(1 ligne) ; toute anomalie est comptée et remontée, jamais fatale.
 */
export async function scanSession(ref: SessionRef, maxPrompts: number): Promise<SessionReport> {
  const tokens = new TokensAggregator();
  const toolResults = new ToolResultsAggregator();
  const reads = new ReadsAggregator();
  const subagents = new SubagentsAggregator();
  const context = new ContextAggregator();
  const prompts = new PromptsAggregator(maxPrompts);
  const turns = new TurnsAggregator();
  const spawnSeen = new Set<string>();
  let events = 0;
  let parseErrors = 0;
  const otherEventTypes: Record<string, number> = {};
  let cwd: string | null = null;
  let gitBranch: string | null = null;
  const versions = new Set<string>();
  const clock = new SessionClock();
  const sessionKind = new SessionKindAggregator();
  let skipped: string | undefined;

  async function scanFile(filePath: string, agentKey: string): Promise<void> {
    for await (const line of iterJsonlLines(filePath)) {
      events += 1;
      if (!line.ok) {
        parseErrors += 1;
        continue;
      }
      const meta = extractLineMeta(line.value);
      if (cwd === null && meta.cwd !== undefined) cwd = meta.cwd;
      if (gitBranch === null && meta.gitBranch !== undefined) gitBranch = meta.gitBranch;
      if (meta.version !== undefined) versions.add(meta.version);
      for (const evt of normalizeEvent(line.value)) {
        switch (evt.kind) {
          case 'assistant':
            tokens.addAssistant(evt, agentKey);
            context.addAssistant(evt, agentKey);
            turns.addAssistant(evt, agentKey);
            for (const tu of evt.toolUses) {
              toolResults.registerToolUse(tu);
              reads.registerToolUse(tu);
              turns.registerToolUse(tu, agentKey);
              // La même ligne assistant est répétée par content block : dédup des spawns par id.
              if (agentKey === 'main' && !spawnSeen.has(tu.id)) {
                spawnSeen.add(tu.id);
                subagents.addSpawnToolUse(tu.name);
              }
            }
            if (agentKey === 'main') clock.add(evt.timestamp);
            break;
          case 'tool_result':
            toolResults.addToolResult(evt);
            reads.addToolResult(evt, agentKey);
            if (agentKey === 'main') clock.add(evt.timestamp);
            break;
          case 'user_prompt':
            if (agentKey === 'main') {
              clock.add(evt.timestamp);
              prompts.addPrompt(evt);
              turns.addPrompt(evt);
              sessionKind.addPrompt(evt);
              context.addPrompt(evt);
            }
            break;
          case 'compact':
            context.addCompact(evt, agentKey);
            break;
          case 'meta':
            break;
          case 'other':
            otherEventTypes[evt.topLevelType] = (otherEventTypes[evt.topLevelType] ?? 0) + 1;
            break;
        }
      }
    }
  }

  try {
    await scanFile(ref.mainPath, 'main');
  } catch (err) {
    skipped = `transcript principal illisible : ${err instanceof Error ? err.message : String(err)}`;
  }

  if (skipped === undefined) {
    for (const sub of ref.subagents) {
      let agentType: string | null = null;
      if (sub.metaPath !== null) {
        try {
          const parsed = JSON.parse(await readFile(sub.metaPath, 'utf8')) as { agentType?: unknown };
          agentType = typeof parsed.agentType === 'string' ? parsed.agentType : null;
        } catch {
          // meta.json illisible : side-car compté « sans meta »
        }
      }
      subagents.addSidecar(agentType);
      try {
        await scanFile(sub.jsonlPath, `agent-${sub.agentId}`);
      } catch {
        parseErrors += 1; // fichier sous-agent illisible : visible, pas fatal
      }
    }
  }

  const tokensResult = tokens.result();
  return {
    sessionId: ref.sessionId,
    projectSlug: ref.projectSlug,
    cwd,
    gitBranch,
    clientVersions: [...versions].sort(),
    startedAt: clock.first(),
    endedAt: clock.last(),
    sessionKind: sessionKind.result(),
    tokens: tokensResult,
    netTokens: netTokens(tokensResult.total),
    toolResults: toolResults.result(),
    reads: reads.result(),
    subagents: subagents.result(),
    context: context.result(),
    prompts: prompts.result(),
    turns: turns.result(),
    events,
    parseErrors,
    otherEventTypes,
    ...(skipped !== undefined ? { skipped } : {}),
  };
}

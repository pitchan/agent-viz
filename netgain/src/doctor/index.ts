import { homedir } from 'node:os';
import path from 'node:path';
import type { DoctorCliOptions } from '../cli-args.js';
import { discoverSessions, parseSince } from '../core/discovery.js';
import { findClaudeMdFiles } from './aggregators/context.js';
import { stableStringify } from './report/json.js';
import { renderReport } from './report/terminal.js';
import type { AggregateTotals, DoctorReport, ProjectReport, SessionReport } from './report/types.js';
import { scanSession } from './scan-session.js';

export interface DoctorOptions {
  claudeDir: string;
  project?: string;
  since?: Date;
  last?: number;
  maxPrompts?: number;
}

const DEFAULT_MAX_PROMPTS = 100;

export async function runDoctor(opts: DoctorOptions): Promise<DoctorReport> {
  const refs = await discoverSessions(opts.claudeDir, {
    ...(opts.project !== undefined ? { project: opts.project } : {}),
    ...(opts.since !== undefined ? { since: opts.since } : {}),
    ...(opts.last !== undefined ? { last: opts.last } : {}),
  });

  const byProject = new Map<string, SessionReport[]>();
  for (const ref of refs) {
    const report = await scanSession(ref, opts.maxPrompts ?? DEFAULT_MAX_PROMPTS);
    const list = byProject.get(ref.projectSlug) ?? [];
    list.push(report);
    byProject.set(ref.projectSlug, list);
  }

  const projects: ProjectReport[] = [...byProject.entries()]
    .map(([projectSlug, sessions]) => {
      const cwd = sessions.find((s) => s.cwd !== null)?.cwd ?? null;
      return {
        projectSlug,
        cwd,
        claudeMdFiles: findClaudeMdFiles(cwd, opts.claudeDir),
        sessions,
        totals: totalsOf(sessions),
      };
    })
    .sort((a, b) => b.totals.netTokens - a.totals.netTokens);

  const all = projects.flatMap((p) => p.sessions);
  const otherEventTypes: Record<string, number> = {};
  const unknownModels = new Set<string>();
  const clientVersions = new Set<string>();
  let events = 0;
  let parseErrors = 0;
  for (const s of all) {
    events += s.events;
    parseErrors += s.parseErrors;
    for (const [t, n] of Object.entries(s.otherEventTypes)) otherEventTypes[t] = (otherEventTypes[t] ?? 0) + n;
    for (const m of s.tokens.unknownModels) unknownModels.add(m);
    for (const v of s.clientVersions) clientVersions.add(v);
  }

  return {
    generatedAt: new Date().toISOString(),
    claudeDir: opts.claudeDir,
    filters: {
      ...(opts.project !== undefined ? { project: opts.project } : {}),
      ...(opts.since !== undefined ? { since: opts.since.toISOString() } : {}),
      ...(opts.last !== undefined ? { last: opts.last } : {}),
    },
    scan: {
      sessions: all.length,
      skippedSessions: all.filter((s) => s.skipped !== undefined).length,
      events,
      parseErrors,
      otherEventTypes,
      unknownModels: [...unknownModels].sort(),
      clientVersions: [...clientVersions].sort(),
    },
    projects,
    totals: totalsOf(all),
  };
}

function totalsOf(sessions: SessionReport[]): AggregateTotals {
  const sum = (f: (s: SessionReport) => number): number => sessions.reduce((acc, s) => acc + f(s), 0);
  return {
    sessions: sessions.length,
    netTokens: sum((s) => s.netTokens),
    costUsd: sum((s) => s.tokens.costUsd),
    costComplete: sessions.every((s) => s.tokens.costComplete),
    toolResultBytes: sum((s) => s.toolResults.totalBytes),
    bandBytes: sum((s) => s.toolResults.bySize.band.bytes),
    subagentSidecars: sum((s) => s.subagents.sidecarCount),
    mapShapedPrompts: sum((s) => s.prompts.mapShapedCount),
    totalPrompts: sum((s) => s.prompts.totalPrompts),
    turns: sum((s) => s.turns.turns),
    triggeredTurns: sum((s) => s.turns.triggered.turns),
    triggeredNetTokens: sum((s) => s.turns.triggered.netTokens),
    silentNetTokens: sum((s) => s.turns.silent.netTokens),
    turnsUnattributedNetTokens: sum((s) => s.turns.unattributedNetTokens),
    agentGestureEvents: sum((s) => s.turns.agentGraph.events),
    agentGrepGestures: sum((s) => s.turns.agentGraph.byKind.grepImport),
    agentBashGestures: sum((s) => s.turns.agentGraph.byKind.bashImport),
    agentSpawnGestures: sum((s) => s.turns.agentGraph.byKind.spawnGraphPrompt),
    agentOnlyTurns: sum((s) => s.turns.agentGraph.agentOnly.turns),
    agentOnlyNetTokens: sum((s) => s.turns.agentGraph.agentOnly.netTokens),
  };
}

export async function runDoctorCli(cli: DoctorCliOptions): Promise<number> {
  const claudeDir = cli.claudeDir ?? process.env['NETGAIN_CLAUDE_DIR'] ?? path.join(homedir(), '.claude');
  let since: Date | undefined;
  if (cli.since !== undefined) {
    try {
      since = parseSince(cli.since, new Date());
    } catch (err) {
      process.stderr.write(`netgain : ${err instanceof Error ? err.message : String(err)}\n`);
      return 2;
    }
  }
  const common = {
    ...(cli.project !== undefined ? { project: cli.project } : {}),
    ...(since !== undefined ? { since } : {}),
    ...(cli.last !== undefined ? { last: cli.last } : {}),
  };

  if (cli.list) {
    const refs = await discoverSessions(claudeDir, common);
    for (const r of refs) {
      process.stdout.write(`${r.projectSlug}  ${r.sessionId}  ${r.mtime.toISOString()}  ${r.subagents.length} sous-agent(s)\n`);
    }
    process.stdout.write(`${refs.length} session(s) découverte(s) sous ${claudeDir}\n`);
    return 0;
  }

  const report = await runDoctor({
    claudeDir,
    ...common,
    ...(cli.maxPrompts !== undefined ? { maxPrompts: cli.maxPrompts } : {}),
  });
  process.stdout.write(cli.json ? `${stableStringify(report)}\n` : renderReport(report));
  return 0;
}

/**
 * Surface publique consommée par le produit Observatoire : l'API GRANULAIRE.
 * runDoctor rescanne tout à chaque appel ; l'incrémentalité se décide côté
 * appelant, session par session, d'où l'export direct de scanSession.
 */
export { netTokens } from './aggregators/tokens.js';
export { scanSession } from './scan-session.js';
export type { NoMarkerDetail } from './aggregators/context.js';
export type { SessionKind } from './aggregators/session-kind.js';
export type { TokenBucket, TokensResult } from './aggregators/tokens.js';
export type { AggregateTotals, DoctorReport, ProjectReport, SessionReport } from './report/types.js';

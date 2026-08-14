'use strict';
// The observatory's business service: it orchestrates store, engine, config
// inventory, rules and ranking. It performs no I/O of its own — every
// collaborator arrives through deps, which is what makes it testable and what
// keeps this file about sequencing rather than plumbing.

import { SCAN_VERSION } from './scan-version.ts';
import { runIncrementalScan } from './scan.ts';
import type { AnalysisScanMessage } from './scan.ts';
import { toAnalysedSessions } from './session-mapper.ts';
import { mcpUsageBySession } from './mcp-usage.ts';
import { computeSummary } from './summary.ts';
import { computeModelCosts } from './model-costs.ts';
import { buildProvenance } from './provenance.ts';
import { cwdOfReport, displayPath, nameProjects } from './project-label.ts';
import { evaluateAll, RULES } from './rules/registry.ts';
import { applyCrossLinks } from './rules/cross-links.ts';
import { rankByBasis } from './rules/ranking.ts';
import type { Store, SessionRow } from './store.ts';
import type { Engine } from './engine.ts';
import type { ConfigItem, SessionKind, SessionReport } from './rules/types.ts';
import type { PriceTable } from '../../engine/core/pricing.ts';

// Two windows, deliberately distinct. WINDOW_DAYS is what the user can pick
// for reading and advice; scanSinceDays (90, the widest offered) is what
// persistence always covers, so no chosen window ever misses data — mtime
// >= started_at guarantees the inclusion. Exported as the validation
// authority: the client keeps only a display copy.
const WINDOW_DAYS: number[] = [7, 30, 90];

interface ServiceDeps {
  store: Store;
  loadEngine: () => Promise<Engine>;
  collectConfig: () => Promise<ConfigItem[]>;
  broadcast: (message: AnalysisScanMessage) => void;
  now: () => Date;
  claudeDir: string;
  sinceDays: number;
  scanSinceDays: number;
}

interface ScanDaysOptions { days?: number }
interface WindowOptions { days?: number; includeMachine?: boolean }
interface SessionsOptions { project?: string; days?: number; includeMachine?: boolean }

interface WindowBasis {
  counts: { interactive: number; headless: number; unknown: number };
  includeMachine: boolean;
}
interface WindowPeriod {
  from: string;
  to: string;
  days: number;
}

// project/report can be null on a genuinely sparse (pre-M1.1) row — see
// store.ts's SessionRow comment; honest here too, never a guessed fallback.
type SessionListRow = Omit<SessionRow, 'reportJson'> & { projectPath: string | null };
type SessionDetail = Omit<SessionRow, 'reportJson'> & { report: SessionReport | null };

function createObservatoryService(deps: ServiceDeps) {
  const { store, loadEngine, collectConfig, broadcast, now, claudeDir, sinceDays, scanSinceDays } = deps;

  const clampDays = (days: number | undefined): number =>
    (days !== undefined && WINDOW_DAYS.includes(days) ? days : sinceDays);
  const sinceOf = (days: number): string => new Date(now().getTime() - days * 24 * 3600 * 1000).toISOString();
  // Rules only ever evaluate interactive sessions: machine and unknown
  // sessions are never advised on. includeMachine only affects what the
  // table and summary display, and the summary always reports the excluded
  // counts.
  const KINDS_HUMAN: SessionKind[] = ['interactive'];
  // toAnalysedSessions (session-mapper.ts) expects the always-complete row a
  // fresh upsertSession writes. Every call below always passes `since`, and a
  // sparse pre-M1.1 row (store.ts's SessionRow comment) never carries a
  // started_at — `started_at >= ?` structurally excludes it, so a row that
  // reaches this point is never one of those; the cast documents that
  // boundary instead of widening session-mapper.ts's own row type.
  const toAnalysable = (rows: SessionRow[]): Parameters<typeof toAnalysedSessions>[0] =>
    rows as Parameters<typeof toAnalysedSessions>[0];
  const humanSessions = (from: string) =>
    toAnalysedSessions(toAnalysable(store.listSessions({ since: from, kinds: KINDS_HUMAN })));

  // A missing engine must be distinguishable from a genuine failure, so the
  // routes can answer 503 with its exact cause instead of a blank 500.
  async function engine(): Promise<Engine> {
    try {
      return await loadEngine();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const wrapped = Object.assign(new Error(message), { engineMissing: true });
      throw wrapped;
    }
  }

  return {
    async scan({ days }: ScanDaysOptions = {}): Promise<Awaited<ReturnType<typeof runIncrementalScan>>> {
      const resolved = await engine();
      const outcome = await runIncrementalScan(
        { engine: resolved, store, broadcast, now },
        { claudeDir, sinceDays: scanSinceDays, scanVersion: SCAN_VERSION });

      const takenAt = now().toISOString();
      store.replaceConfigItems(takenAt, await collectConfig());

      // Persistence just covered 90 days above; advice reads only the
      // requested window (default sinceDays), human sessions only, and every
      // recommendation carries the period it was observed on.
      const adviceDays = clampDays(days);
      const periodFrom = sinceOf(adviceDays);
      const periodTo = now().toISOString();
      // Le projet est nommé ici, une seule fois, et jamais par les règles : le
      // slug qu'elles portent en sujet est une identité, pas un libellé.
      const sessions = humanSessions(periodFrom);
      const advice = nameProjects(
        applyCrossLinks(evaluateAll({ sessions, configItems: store.listConfigItems() })),
        sessions,
        RULES,
      ).map(rec => ({ ...rec, periodFrom, periodTo }));
      store.upsertRecommendations(advice, periodTo);

      // 'done' is the client's reload signal: it fires only once the
      // recomputed advice is stored — inside the scan it would race the
      // advice write, and a post-purge reload would read an empty table.
      broadcast({
        type: 'analysisScan', phase: 'done', total: outcome.discovered,
        scanned: outcome.scanned, skipped: outcome.skipped, failed: outcome.failed,
      });

      return outcome;
    },

    async purge(): Promise<void> {
      // Refuse to wipe a base the engine cannot rebuild: surface the missing
      // engine (503 upstream) before touching anything.
      await engine();
      store.purge();
    },

    async summary({ days, includeMachine = false }: WindowOptions = {}): Promise<ReturnType<typeof computeSummary>> {
      // Touching the engine here makes a missing package surface as an error
      // rather than as a silently empty dashboard.
      await engine();
      const state = store.getScanState(claudeDir);
      const d = clampDays(days);
      const from = sinceOf(d);
      const rows = includeMachine
        ? store.listSessions({ since: from })
        : store.listSessions({ since: from, kinds: KINDS_HUMAN });
      return computeSummary(toAnalysedSessions(toAnalysable(rows)), {
        lastScanAt: state ? state.lastScanAt : null,
        engine: { ok: true, error: null },
        basis: { counts: store.countByKind({ since: from }), includeMachine },
        period: { from, to: now().toISOString(), days: d },
      });
    },

    async modelCosts(
      { days, includeMachine = false }: WindowOptions = {},
    ): Promise<ReturnType<typeof computeModelCosts> & { basis: WindowBasis; period: WindowPeriod }> {
      await engine();
      const d = clampDays(days);
      const from = sinceOf(d);
      const rows = includeMachine
        ? store.listSessions({ since: from })
        : store.listSessions({ since: from, kinds: KINDS_HUMAN });
      return {
        ...computeModelCosts(toAnalysedSessions(toAnalysable(rows))),
        basis: { counts: store.countByKind({ since: from }), includeMachine },
        period: { from, to: now().toISOString(), days: d },
      };
    },

    // Tariff sheet + provenance: independent of the window — they answer
    // "how are the numbers made", not "what happened lately".
    async pricing(): Promise<{
      priceTable: PriceTable;
      provenance: ReturnType<typeof buildProvenance>;
      engineVersion: string;
      scanVersion: number;
    }> {
      const resolved = await engine();
      const table = resolved.priceTable();
      return {
        priceTable: table,
        provenance: buildProvenance({ engineVersion: resolved.version, priceSource: table.source }),
        engineVersion: resolved.version,
        scanVersion: SCAN_VERSION,
      };
    },

    async sessions({ project, days, includeMachine = false }: SessionsOptions = {}): Promise<SessionListRow[]> {
      const from = sinceOf(clampDays(days));
      const kinds = includeMachine ? undefined : KINDS_HUMAN;
      // Le tableau nomme le projet comme les cartes de conseil : le vrai chemin
      // quand le transcript le porte, le slug sinon. `project` reste l'identité
      // sur laquelle filtre la requête.
      return store.listSessions({ project, since: from, kinds })
        .map(({ reportJson, ...row }) => {
          const cwd = cwdOfReport(reportJson === null ? null : JSON.parse(reportJson) as SessionReport);
          return { ...row, projectPath: cwd ? displayPath(cwd) : row.project };
        });
    },

    async session(id: string): Promise<SessionDetail | null> {
      const row = store.getSession(id);
      if (!row) return null;
      const { reportJson, ...rest } = row;
      return { ...rest, report: reportJson === null ? null : JSON.parse(reportJson) as SessionReport };
    },

    async configAudit(): Promise<{
      items: ConfigItem[];
      usage: Record<string, { calls: number; sessions: number }>;
      sessions: number;
    }> {
      const sessions = humanSessions(sinceOf(sinceDays));
      const usage: Record<string, { calls: number; sessions: number }> = {};
      for (const [server, stat] of mcpUsageBySession(sessions)) {
        usage[server] = { calls: stat.calls, sessions: stat.sessions.size };
      }
      return { items: store.listConfigItems(), usage, sessions: sessions.length };
    },

    async recommendations(): Promise<ReturnType<typeof rankByBasis>> {
      const state = store.getScanState(claudeDir);
      return rankByBasis(store.listRecommendations({}),
        { lastScanAt: state ? state.lastScanAt : null });
    },

    async setRecommendationStatus(id: number, status: string): Promise<boolean> {
      return store.setRecommendationStatus(id, status, now().toISOString());
    },
  };
}

export { createObservatoryService, WINDOW_DAYS };

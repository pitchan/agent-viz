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
import { computeModelCosts, modelsSeen } from './model-costs.ts';
import { computeSkillUsage } from './skill-usage.ts';
import { buildProvenance } from './provenance.ts';
import { cwdOfReport, displayPath, nameProjects } from './project-label.ts';
import { evaluateAll, RULES } from './rules/registry.ts';
import { applyCrossLinks } from './rules/cross-links.ts';
import { rankByBasis } from './rules/ranking.ts';
import type { Store, SessionRow } from './store.ts';
import type { Engine } from './engine.ts';
import type { ConfigItem, SessionKind, SessionReport } from './rules/types.ts';
import type { PriceTable } from '../../engine/core/pricing.ts';
import { isApplicable } from '../price-adoption.ts';
import type { Adopted, ApplicableDrift } from '../price-adoption.ts';
import type { DriftSnapshot } from '../pricing.ts';

// Two windows, deliberately distinct. WINDOW_DAYS is what the user can pick
// for reading and advice; scanSinceDays (90, the widest offered) is what
// persistence always covers, so no chosen window ever misses data — mtime
// >= started_at guarantees the inclusion. Exported as the validation
// authority: the client keeps only a display copy.
const WINDOW_DAYS: number[] = [7, 30, 90];

interface ServiceDeps {
  store: Store;
  engine: Engine;
  collectConfig: () => Promise<ConfigItem[]>;
  broadcast: (message: AnalysisScanMessage | PricingAdoptedMessage) => void;
  /** Écrit et applique le tarif relevé par la vigie pour ce modèle. */
  adoptPrice: (drift: ApplicableDrift) => Promise<Adopted>;
  /** La vigie des tarifs : ce qu'elle a vu, et un passage (null = abouti, sinon la cause de l'échec). */
  vigie: { snapshot: () => DriftSnapshot; refresh: () => Promise<string | null> };
  now: () => Date;
  claudeDir: string;
  sinceDays: number;
  scanSinceDays: number;
}

interface PricingAdoptedMessage { type: 'pricingAdopted'; model: string; kind: Adopted['kind']; prices: Adopted['prices'] }
interface PriceCheck extends DriftSnapshot {
  failure: string | null;
  adopted: Adopted[];
  errors: { model: string; message: string }[];
}
interface ScanDaysOptions { days?: number; forceIds?: ReadonlySet<string> }
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

// project/report can be null on a genuinely sparse row — see
// store.ts's SessionRow comment; honest here too, never a guessed fallback.
type SessionListRow = Omit<SessionRow, 'reportJson'> & { projectPath: string | null };
type SessionDetail = Omit<SessionRow, 'reportJson'> & { report: SessionReport | null };

function createObservatoryService(deps: ServiceDeps) {
  const { store, engine, collectConfig, broadcast, adoptPrice, vigie, now, claudeDir, sinceDays, scanSinceDays } = deps;

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
  // sparse row (store.ts's SessionRow comment) never carries a
  // started_at — `started_at >= ?` structurally excludes it, so a row that
  // reaches this point is never one of those; the cast documents that
  // boundary instead of widening session-mapper.ts's own row type.
  const toAnalysable = (rows: SessionRow[]): Parameters<typeof toAnalysedSessions>[0] =>
    rows as Parameters<typeof toAnalysedSessions>[0];
  const humanSessions = (from: string) =>
    toAnalysedSessions(toAnalysable(store.listSessions({ since: from, kinds: KINDS_HUMAN })));
  // Every windowed read shares this: the sessions of the chosen period, the
  // human/machine basis they were read on, and the period itself.
  const readWindow = ({ days, includeMachine = false }: WindowOptions) => {
    const d = clampDays(days);
    const from = sinceOf(d);
    const rows = includeMachine
      ? store.listSessions({ since: from })
      : store.listSessions({ since: from, kinds: KINDS_HUMAN });
    const basis: WindowBasis = { counts: store.countByKind({ since: from }), includeMachine };
    const period: WindowPeriod = { from, to: now().toISOString(), days: d };
    return { sessions: toAnalysedSessions(toAnalysable(rows)), basis, period };
  };

  // Les modèles des transcripts scannés : un tarif ne s'affiche, ni dans le panneau
  // ni en alerte, que pour un modèle réellement appelé.
  const modelsInTranscripts = () =>
    modelsSeen(toAnalysedSessions(toAnalysable(store.listSessions({ since: sinceOf(scanSinceDays) }))));

  // Adopter touche des coûts déjà rangés : on relit les sessions incomplètes, et pour
  // un tarif différent celles finies depuis `from`, que leur fichier ait bougé ou non.
  const applyAdoption = async (drift: ApplicableDrift): Promise<Adopted> => {
    const adopted = await adoptPrice(drift);
    const { model, from } = adopted;
    const forceIds = new Set(store.listSessions({})
      .filter(r => !r.costComplete || (from !== null && r.endedAt !== null && r.endedAt >= from))
      .map(r => r.id));
    if (modelsInTranscripts().has(model)) {
      broadcast({ type: 'pricingAdopted', model, kind: adopted.kind, prices: adopted.prices });
    }
    await service.scan({ forceIds });
    return adopted;
  };

  // Un échec de la vigie ne vide rien : les dérives déjà relevées restent tentées. Un
  // modèle sans fenêtre de contexte connue attend, la page des modèles doit le porter.
  const checkPricesNow = async (): Promise<PriceCheck> => {
    const failure = await vigie.refresh();
    const adopted: Adopted[] = [];
    const errors: PriceCheck['errors'] = [];
    for (const d of vigie.snapshot().drifts.filter(isApplicable)) {
      try {
        adopted.push(await applyAdoption(d));
      } catch (err) {
        errors.push({ model: d.model, message: err instanceof Error ? err.message : String(err) });
      }
    }
    return { failure, adopted, errors, ...vigie.snapshot() };
  };
  let checkQueue: Promise<void> = Promise.resolve();

  const service = {
    async scan({ days, forceIds }: ScanDaysOptions = {}): Promise<Awaited<ReturnType<typeof runIncrementalScan>>> {
      const outcome = await runIncrementalScan(
        { engine, store, broadcast, now },
        { claudeDir, sinceDays: scanSinceDays, scanVersion: SCAN_VERSION, forceIds });

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
      store.purge();
    },

    async summary(opts: WindowOptions = {}): Promise<ReturnType<typeof computeSummary>> {
      const state = store.getScanState(claudeDir);
      const { sessions, basis, period } = readWindow(opts);
      return computeSummary(sessions, { lastScanAt: state ? state.lastScanAt : null, basis, period });
    },

    async modelCosts(
      opts: WindowOptions = {},
    ): Promise<ReturnType<typeof computeModelCosts> & { basis: WindowBasis; period: WindowPeriod }> {
      const { sessions, basis, period } = readWindow(opts);
      return { ...computeModelCosts(sessions), basis, period };
    },

    async skillUsage(
      { project, ...opts }: WindowOptions & { project?: string } = {},
    ): Promise<ReturnType<typeof computeSkillUsage> & { basis: WindowBasis; period: WindowPeriod }> {
      const { sessions, basis, period } = readWindow(opts);
      return { ...computeSkillUsage(sessions, project), basis, period };
    },

    // Tariff sheet + provenance: independent of the window — they answer
    // "how are the numbers made", not "what happened lately". Tariffs and pending
    // updates are limited to models the scanned transcripts actually call.
    async pricing(): Promise<{
      priceTable: PriceTable;
      provenance: ReturnType<typeof buildProvenance>;
      engineVersion: string;
      scanVersion: number;
      updates: DriftSnapshot;
    }> {
      const table = engine.priceTable();
      const seen = modelsInTranscripts();
      const updates = vigie.snapshot();
      return {
        priceTable: {
          ...table,
          entries: table.entries.filter(e => seen.has(e.model)),
          zeroCost: table.zeroCost.filter(z => seen.has(z.model)),
        },
        provenance: buildProvenance({ engineVersion: engine.version, priceSource: table.source }),
        engineVersion: engine.version,
        scanVersion: SCAN_VERSION,
        updates: { ...updates, drifts: updates.drifts.filter(d => seen.has(d.model)) },
      };
    },

    // Un passage de la vigie, puis l'application de chaque tarif relevé : au démarrage,
    // chaque jour, et à la demande du panneau. En file, jamais deux à la fois : deux
    // adoptions concurrentes réécriraient prices.json l'une par-dessus l'autre.
    checkPrices(): Promise<PriceCheck> {
      const run = checkQueue.then(checkPricesNow);
      checkQueue = run.then(() => undefined, () => undefined);
      return run;
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

    async setRecommendationStatus(id: number, status: string, reason: string | null = null): Promise<boolean> {
      return store.setRecommendationStatus(id, status, now().toISOString(), reason);
    },

  };
  return service;
}

export { createObservatoryService, WINDOW_DAYS };

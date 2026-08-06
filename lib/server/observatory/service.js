'use strict';
// The observatory's business service: it orchestrates store, engine, config
// inventory, rules and ranking. It performs no I/O of its own — every
// collaborator arrives through deps, which is what makes it testable and what
// keeps this file about sequencing rather than plumbing.

const { SCAN_VERSION } = require('./scan-version');
const { runIncrementalScan } = require('./scan');
const { toAnalysedSessions } = require('./session-mapper');
const { mcpUsageBySession } = require('./mcp-usage');
const { computeSummary } = require('./summary');
const { computeModelCosts } = require('./model-costs');
const { buildProvenance } = require('./provenance');
const { cwdOfReport, displayPath, nameProjects } = require('./project-label');
const { evaluateAll, RULES } = require('./rules/registry');
const { applyCrossLinks } = require('./rules/cross-links');
const { rankByBasis } = require('./rules/ranking');

// Two windows, deliberately distinct. WINDOW_DAYS is what the user can pick
// for reading and advice; scanSinceDays (90, the widest offered) is what
// persistence always covers, so no chosen window ever misses data — mtime
// >= started_at guarantees the inclusion. Exported as the validation
// authority: the client keeps only a display copy.
const WINDOW_DAYS = [7, 30, 90];

function createObservatoryService(deps) {
  const { store, loadEngine, collectConfig, broadcast, now, claudeDir, sinceDays, scanSinceDays } = deps;

  const clampDays = days => (WINDOW_DAYS.includes(days) ? days : sinceDays);
  const sinceOf = days => new Date(now().getTime() - days * 24 * 3600 * 1000).toISOString();
  // Rules only ever evaluate interactive sessions: machine and unknown
  // sessions are never advised on. includeMachine only affects what the
  // table and summary display, and the summary always reports the excluded
  // counts.
  const KINDS_HUMAN = ['interactive'];
  const humanSessions = from => toAnalysedSessions(store.listSessions({ since: from, kinds: KINDS_HUMAN }));

  // A missing engine must be distinguishable from a genuine failure, so the
  // routes can answer 503 with its exact cause instead of a blank 500.
  async function engine() {
    try {
      return await loadEngine();
    } catch (err) {
      const wrapped = new Error(err.message);
      wrapped.engineMissing = true;
      throw wrapped;
    }
  }

  return {
    async scan({ days } = {}) {
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

    async purge() {
      // Refuse to wipe a base the engine cannot rebuild: surface the missing
      // engine (503 upstream) before touching anything.
      await engine();
      store.purge();
    },

    async summary({ days, includeMachine = false } = {}) {
      // Touching the engine here makes a missing package surface as an error
      // rather than as a silently empty dashboard.
      await engine();
      const state = store.getScanState(claudeDir);
      const d = clampDays(days);
      const from = sinceOf(d);
      const rows = includeMachine
        ? store.listSessions({ since: from })
        : store.listSessions({ since: from, kinds: KINDS_HUMAN });
      return computeSummary(toAnalysedSessions(rows), {
        lastScanAt: state ? state.lastScanAt : null,
        engine: { ok: true, error: null },
        basis: { counts: store.countByKind({ since: from }), includeMachine },
        period: { from, to: now().toISOString(), days: d },
      });
    },

    async modelCosts({ days, includeMachine = false } = {}) {
      await engine();
      const d = clampDays(days);
      const from = sinceOf(d);
      const rows = includeMachine
        ? store.listSessions({ since: from })
        : store.listSessions({ since: from, kinds: KINDS_HUMAN });
      return {
        ...computeModelCosts(toAnalysedSessions(rows)),
        basis: { counts: store.countByKind({ since: from }), includeMachine },
        period: { from, to: now().toISOString(), days: d },
      };
    },

    // Tariff sheet + provenance: independent of the window — they answer
    // "how are the numbers made", not "what happened lately".
    async pricing() {
      const resolved = await engine();
      const table = resolved.priceTable();
      return {
        priceTable: table,
        provenance: buildProvenance({ engineVersion: resolved.version, priceSource: table.source }),
        engineVersion: resolved.version,
        scanVersion: SCAN_VERSION,
      };
    },

    async sessions({ project, days, includeMachine = false } = {}) {
      const from = sinceOf(clampDays(days));
      const kinds = includeMachine ? undefined : KINDS_HUMAN;
      // Le tableau nomme le projet comme les cartes de conseil : le vrai chemin
      // quand le transcript le porte, le slug sinon. `project` reste l'identité
      // sur laquelle filtre la requête.
      return store.listSessions({ project, since: from, kinds })
        .map(({ reportJson, ...row }) => {
          const cwd = cwdOfReport(JSON.parse(reportJson));
          return { ...row, projectPath: cwd ? displayPath(cwd) : row.project };
        });
    },

    async session(id) {
      const row = store.getSession(id);
      if (!row) return null;
      const { reportJson, ...rest } = row;
      return { ...rest, report: JSON.parse(reportJson) };
    },

    async configAudit() {
      const sessions = humanSessions(sinceOf(sinceDays));
      const usage = {};
      for (const [server, stat] of mcpUsageBySession(sessions)) {
        usage[server] = { calls: stat.calls, sessions: stat.sessions.size };
      }
      return { items: store.listConfigItems(), usage, sessions: sessions.length };
    },

    async recommendations() {
      const state = store.getScanState(claudeDir);
      return rankByBasis(store.listRecommendations({}),
        { lastScanAt: state ? state.lastScanAt : null });
    },

    async setRecommendationStatus(id, status) {
      return store.setRecommendationStatus(id, status, now().toISOString());
    },
  };
}

module.exports = { createObservatoryService, WINDOW_DAYS };

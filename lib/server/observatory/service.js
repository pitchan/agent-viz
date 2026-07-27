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
const { evaluateAll } = require('./rules/registry');
const { rankByBasis } = require('./rules/ranking');

function createObservatoryService(deps) {
  const { store, loadEngine, collectConfig, broadcast, now, claudeDir, sinceDays } = deps;

  const defaultSince = () =>
    new Date(now().getTime() - sinceDays * 24 * 3600 * 1000).toISOString();

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

  const periodSessions = since => toAnalysedSessions(store.listSessions({ since: since ?? defaultSince() }));

  return {
    async scan() {
      const resolved = await engine();
      const outcome = await runIncrementalScan(
        { engine: resolved, store, broadcast, now },
        { claudeDir, sinceDays, scanVersion: SCAN_VERSION });

      const takenAt = now().toISOString();
      store.replaceConfigItems(takenAt, await collectConfig());
      store.upsertRecommendations(
        evaluateAll({ sessions: periodSessions(), configItems: store.listConfigItems() }),
        takenAt);
      return outcome;
    },

    async summary({ since } = {}) {
      // Touching the engine here makes a missing package surface as an error
      // rather than as a silently empty dashboard.
      await engine();
      const state = store.getScanState(claudeDir);
      return computeSummary(periodSessions(since), {
        lastScanAt: state ? state.lastScanAt : null,
        engine: { ok: true, error: null },
      });
    },

    async sessions({ project, since } = {}) {
      return store.listSessions({ project, since: since ?? defaultSince() })
        .map(({ reportJson, ...rest }) => rest);
    },

    async session(id) {
      const row = store.getSession(id);
      if (!row) return null;
      const { reportJson, ...rest } = row;
      return { ...rest, report: JSON.parse(reportJson) };
    },

    async configAudit() {
      const sessions = periodSessions();
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

module.exports = { createObservatoryService };

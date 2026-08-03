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
      const advice = applyCrossLinks(evaluateAll({
        sessions: humanSessions(periodFrom),
        configItems: store.listConfigItems(),
      })).map(rec => ({ ...rec, periodFrom, periodTo }));
      store.upsertRecommendations(advice, periodTo);

      return outcome;
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

    async sessions({ project, days, includeMachine = false } = {}) {
      const from = sinceOf(clampDays(days));
      const kinds = includeMachine ? undefined : KINDS_HUMAN;
      return store.listSessions({ project, since: from, kinds })
        .map(({ reportJson, ...row }) => row);
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

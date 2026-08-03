'use strict';
// R2 — an MCP server is configured nearly everywhere and nearly never used.
//
// Two limits are deliberate and carried in the evidence:
//
// * The inventory is a snapshot of today's configuration, not a history. It is
//   applied to the scanned period (evidence.inventorySnapshot = true).
// * The cost of merely loading a server is not isolable from a transcript. The
//   only measured, attributable cost is the prefix churn marked "tools
//   appeared". When that is zero the recommendation costs zero and therefore
//   never reaches the priority block — that is the price of refusing to invent
//   a saving, and it is intended.

const { COST_BASIS, sumUsd } = require('./cost');
const { THRESHOLDS } = require('./thresholds');
const { mcpUsageBySession } = require('../mcp-usage');

const ID = 'R2';
const CATEGORY = 'configuration';

// Config keys use POSIX separators even on Windows, session cwd does not.
const normalizePath = p => (typeof p === 'string' ? p.replace(/\\/g, '/').toLowerCase() : null);

function isLoadedIn(item, session) {
  if (item.scope === 'user') return true;
  if (!item.scope.startsWith('project:')) return false;
  return normalizePath(item.scope.slice('project:'.length)) === normalizePath(session.report.cwd);
}

function evaluate(ctx) {
  if (ctx.sessions.length === 0) return [];
  const usage = mcpUsageBySession(ctx.sessions);
  const recs = [];

  for (const item of ctx.configItems) {
    if (item.kind !== 'mcp') continue;
    const loaded = ctx.sessions.filter(s => isLoadedIn(item, s));
    if (loaded.length === 0) continue;
    if (loaded.length / ctx.sessions.length < THRESHOLDS.R2.minLoadedShare) continue;

    const usedIn = usage.get(item.name)?.sessions ?? new Set();
    const used = loaded.filter(s => usedIn.has(s.id));
    if (used.length / loaded.length > THRESHOLDS.R2.maxUsedShare) continue;

    recs.push({
      ruleId: ID,
      subject: `${item.name}@${item.scope}`,
      title: `Serveur MCP « ${item.name} » chargé mais quasiment jamais appelé`,
      category: CATEGORY,
      confidence: 'fait',
      estimatedCostUsd: sumUsd(loaded.map(
        s => [s, s.report.context.prefixBreakdown.markers.toolsAppeared.tokens])),
      costBasis: COST_BASIS.MEASURED_TOKENS,
      evidence: {
        sessions: loaded.map(s => s.id),
        scope: item.scope,
        projects: [...new Set(loaded.map(s => s.project))],
        loadedSessions: loaded.length,
        usedSessions: used.length,
        loadedSharePercent: (loaded.length / ctx.sessions.length) * 100,
        usedSharePercent: (used.length / loaded.length) * 100,
        inventorySnapshot: true,
        costComplete: loaded.every(s => s.costComplete),
      },
      action: 'Désactiver ce serveur par défaut et ne l’activer que dans les projets qui s’en servent '
        + '(effet non mesuré en M1 — action à tester).',
    });
  }
  return recs;
}

module.exports = { id: ID, category: CATEGORY, evaluate };

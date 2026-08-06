'use strict';
// R3 — a shell command prints a lot, repeatedly, and nothing filters it.
//
// netgain's candidateFilters already isolates repeated, unrecognised families
// averaging >= 2 KB — literally "the filter that is missing". A family is
// aggregated across sessions first, then judged on its SHARE of the period's
// tool output: an absolute byte floor would fire constantly on a heavy user
// and never on a light one.
//
// Population restriction (user decision of 2026-07-27, from the calibration
// relevé): only families that come from a SHELL COMMAND are considered. Of the
// 17 families that cleared the thresholds on 90 days of real history, 15 were
// agent tools — Read at 70 % of one project's tool output, Grep at 45 % of
// another. R3's action is "target the command: filter, pagination, narrower
// test", and an agent tool has no filter to add: "your Read calls are large"
// is an observation, not an action. Narrow scope is assumed — two pieces of
// advice that hold beat seventeen of which fifteen are inapplicable.

const { COST_BASIS, usdForBytes } = require('./cost');
const { THRESHOLDS } = require('./thresholds');

const ID = 'R3';
const CATEGORY = 'outils';

// netgain names a family after the tool, except for Bash where it names it
// after the command. So "is this family an agent tool?" is answered by a
// declarative table of tool names plus the MCP prefix — everything else is a
// command name. The eight first entries are the ones the relevé actually
// surfaced; the rest complete the same principle so a tool that grows loud
// later does not start producing advice nobody can act on.
const AGENT_TOOL_FAMILIES = new Set([
  'Read', 'Grep', 'Agent', 'Glob', 'WebFetch', 'WebSearch', 'PowerShell', 'ExitPlanMode',
  'Bash', 'BashOutput', 'KillShell', 'Task', 'Edit', 'Write', 'NotebookEdit',
  'TodoWrite', 'SlashCommand', 'Skill', 'EnterPlanMode',
]);
const MCP_PREFIX = 'mcp__';

const isShellCommandFamily = family =>
  !AGENT_TOOL_FAMILIES.has(family) && !family.startsWith(MCP_PREFIX);

function evaluate(ctx) {
  // Denominator: the whole period's tool output. The excluded families were
  // still paid for — they are simply not something the user can act on — so
  // they stay in the share's denominator.
  const periodBytes = ctx.sessions.reduce((acc, s) => acc + s.report.toolResults.totalBytes, 0);
  if (!periodBytes) return [];

  const byFamily = new Map();
  for (const session of ctx.sessions) {
    for (const candidate of session.report.toolResults.candidateFilters) {
      if (!isShellCommandFamily(candidate.family)) continue;
      const agg = byFamily.get(candidate.family)
        ?? { count: 0, bytes: 0, sessions: [], usd: 0, costComplete: true };
      agg.count += candidate.count;
      agg.bytes += candidate.bytes;
      agg.usd += usdForBytes(session, candidate.bytes);
      agg.costComplete = agg.costComplete && session.costComplete;
      if (!agg.sessions.includes(session.id)) agg.sessions.push(session.id);
      byFamily.set(candidate.family, agg);
    }
  }

  const recs = [];
  for (const [family, agg] of byFamily) {
    const share = agg.bytes / periodBytes;
    if (share < THRESHOLDS.R3.minShareOfToolBytes || agg.count < THRESHOLDS.R3.minCount) continue;
    recs.push({
      ruleId: ID,
      subject: family,
      title: `Sortie volumineuse et répétée : ${family}`,
      category: CATEGORY,
      confidence: 'fait',
      estimatedCostUsd: agg.usd,
      costBasis: COST_BASIS.APPROX_BYTES,
      evidence: {
        sessions: agg.sessions,
        bytes: agg.bytes,
        count: agg.count,
        shareOfToolBytesPercent: share * 100,
        costComplete: agg.costComplete,
      },
      action: 'Cibler la commande : filtre, pagination, ou test ciblé plutôt que la suite complète.',
    });
  }
  return recs;
}

module.exports = { id: ID, category: CATEGORY, subjectKind: 'tool', evaluate };

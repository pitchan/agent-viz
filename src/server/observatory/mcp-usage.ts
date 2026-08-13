'use strict';
// What was actually called — the counterpart of config-audit.js.
//
// Tool names are shaped mcp__<server>__<tool>; the server name is everything
// between the first and the last pair of double underscores, which can itself
// contain single underscores (e.g. claude_ai_Gmail).

const MCP_TOOL = /^mcp__(.+)__[^_]+(?:_[^_]+)*$/;

function serverNameOf(toolName) {
  if (typeof toolName !== 'string') return null;
  const match = MCP_TOOL.exec(toolName);
  return match ? match[1] : null;
}

// Map<serverName, { calls, sessions:Set<sessionId> }>. Both figures are needed:
// R2 compares "used in how many sessions" against "loaded in how many", while
// the audit page shows the raw call count.
function mcpUsageBySession(sessions) {
  const usage = new Map();
  for (const session of sessions) {
    for (const [tool, stat] of Object.entries(session.report.toolResults.byTool)) {
      const server = serverNameOf(tool);
      if (server === null) continue;
      const entry = usage.get(server) ?? { calls: 0, sessions: new Set() };
      entry.calls += stat.count;
      entry.sessions.add(session.id);
      usage.set(server, entry);
    }
  }
  return usage;
}

export { serverNameOf, mcpUsageBySession };

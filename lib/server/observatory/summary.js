'use strict';
// Period totals.
//
// Session costs all come from one price table (netgain's embedded one), so
// they are homogeneous and can be summed. Two things are still kept apart:
// cacheRead never enters net tokens, and a single session without a known
// price makes the whole total partial rather than quietly complete.

function computeSummary(sessions, { lastScanAt, engine, basis = null, period = null }) {
  return {
    sessions: sessions.length,
    netTokens: sessions.reduce((acc, s) => acc + s.netTokens, 0),
    costUsd: sessions.reduce((acc, s) => acc + s.costUsd, 0),
    costComplete: sessions.every(s => s.costComplete),
    cacheReadTokens: sessions.reduce((acc, s) => acc + s.report.tokens.total.cacheRead, 0),
    anomalies: {
      parseErrors: sessions.reduce((acc, s) => acc + s.report.parseErrors, 0),
      partialCostSessions: sessions.filter(s => !s.costComplete).length,
    },
    lastScanAt,
    engine,
    basis,
    period,
  };
}

module.exports = { computeSummary };

'use strict';
// Period totals.
//
// Session costs all come from one price table (netgain's embedded one), so
// they are homogeneous and can be summed. Two things are still kept apart:
// cacheRead never enters net tokens, and a single session without a known
// price makes the whole total partial rather than quietly complete.

import type { Session } from './rules/types.ts';
import type { EngineStatus } from './engine.ts';

// Shape of store.countByKind()'s return, duck-typed rather than imported: a
// pure module (no I/O, no clock — see the file docstring) does not reach into
// the SQLite layer just to describe a passthrough field it never inspects.
interface KindCounts {
  interactive: number;
  headless: number;
  unknown: number;
}

interface Basis {
  counts: KindCounts;
  includeMachine: boolean;
}

interface Period {
  from: string;
  to: string;
  days: number;
}

interface SummaryOptions {
  lastScanAt: string | null;
  engine: EngineStatus | null;
  basis?: Basis | null;
  period?: Period | null;
}

interface SummaryAnomalies {
  parseErrors: number;
  partialCostSessions: number;
}

interface Summary {
  sessions: number;
  netTokens: number;
  costUsd: number;
  costComplete: boolean;
  cacheReadTokens: number;
  anomalies: SummaryAnomalies;
  lastScanAt: string | null;
  engine: EngineStatus | null;
  basis: Basis | null;
  period: Period | null;
}

function computeSummary(
  sessions: Session[],
  { lastScanAt, engine, basis = null, period = null }: SummaryOptions,
): Summary {
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

export { computeSummary };

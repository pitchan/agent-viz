'use strict';
// Translation between the persisted session row and the shape the rules read.
// Nothing here knows how a scan runs or how a rule decides — it only converts.

import type { SessionReport as EngineSessionReport } from '../../engine/doctor/report/types.ts';
import type { Session, SessionKind, SessionReport, TokenBucket } from './rules/types.ts';

// Repo convention: net = in + cacheCreate + out, cacheRead excluded. It is not
// re-derived anywhere else in the product.
const netOf = (b: TokenBucket): number => b.in + b.cacheCreate + b.out;

// What toSessionRow actually reads off a FRESH engine report, before it is
// split into (row columns, report_json). Distinct from rules/types.ts's
// SessionReport: that one describes the shape ALREADY reconstituted from
// storage (report nested under Session), this one is the flat shape the
// engine hands back — sessionId/projectSlug/startedAt/... have no equivalent
// there (they live on Session, not on its .report).
type ScannedReport = Pick<EngineSessionReport,
  'sessionId' | 'projectSlug' | 'startedAt' | 'endedAt' | 'sessionKind' | 'netTokens'> & {
  tokens: Pick<EngineSessionReport['tokens'], 'perModel' | 'costUsd' | 'costComplete'>;
};

interface TranscriptRef {
  mainPath: string;
  mtime: Date;
  sizeBytes: number;
}

// The row session-mapper hands to (and reads back from) the store — same
// shape on both sides of the SQLite round-trip, hence named once here.
interface SessionRow {
  id: string;
  project: string;
  transcriptPath: string;
  fileMtime: number;
  fileSize: number;
  scanVersion: number;
  startedAt: string | null;
  endedAt: string | null;
  modelMain: string | null;
  sessionKind: SessionKind | null;
  netTokens: number;
  costUsd: number;
  costComplete: boolean;
  reportJson: string;
}

// The model that produced the most net tokens. A session with several models
// keeps the dominant one for the list view; the full breakdown stays in the
// stored report.
function mainModelOf(report: ScannedReport): string | null {
  let best: string | null = null;
  let bestNet = -1;
  for (const [model, bucket] of Object.entries(report.tokens.perModel)) {
    const net = netOf(bucket);
    if (net > bestNet) { bestNet = net; best = model; }
  }
  return best;
}

function toSessionRow(report: ScannedReport, ref: TranscriptRef, scanVersion: number): SessionRow {
  return {
    id: report.sessionId,
    project: report.projectSlug,
    transcriptPath: ref.mainPath,
    fileMtime: ref.mtime.getTime(),
    fileSize: ref.sizeBytes,
    scanVersion,
    startedAt: report.startedAt,
    endedAt: report.endedAt,
    modelMain: mainModelOf(report),
    sessionKind: report.sessionKind,
    netTokens: report.netTokens,
    costUsd: report.tokens.costUsd,
    costComplete: report.tokens.costComplete,
    reportJson: JSON.stringify(report),
  };
}

function toAnalysedSession(row: SessionRow): Session {
  return {
    id: row.id, project: row.project,
    startedAt: row.startedAt, endedAt: row.endedAt,
    sessionKind: row.sessionKind,
    netTokens: row.netTokens, costUsd: row.costUsd, costComplete: row.costComplete,
    // Round-trip of our OWN JSON.stringify(report) above, not external input —
    // the cast documents that trust boundary instead of leaving it as an
    // implicit `any` (the flow this lot is asked to dry up).
    report: JSON.parse(row.reportJson) as SessionReport,
  };
}

const toAnalysedSessions = (rows: SessionRow[]): Session[] => rows.map(toAnalysedSession);

export { mainModelOf, netOf, toSessionRow, toAnalysedSession, toAnalysedSessions };

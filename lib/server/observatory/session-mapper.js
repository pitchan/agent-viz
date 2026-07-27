'use strict';
// Translation between the persisted session row and the shape the rules read.
// Nothing here knows how a scan runs or how a rule decides — it only converts.

// Repo convention: net = in + cacheCreate + out, cacheRead excluded. It is not
// re-derived anywhere else in the product.
const netOf = b => b.in + b.cacheCreate + b.out;

// The model that produced the most net tokens. A session with several models
// keeps the dominant one for the list view; the full breakdown stays in the
// stored report.
function mainModelOf(report) {
  let best = null;
  let bestNet = -1;
  for (const [model, bucket] of Object.entries(report.tokens.perModel)) {
    const net = netOf(bucket);
    if (net > bestNet) { bestNet = net; best = model; }
  }
  return best;
}

function toSessionRow(report, ref, scanVersion) {
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
    netTokens: report.netTokens,
    costUsd: report.tokens.costUsd,
    costComplete: report.tokens.costComplete,
    reportJson: JSON.stringify(report),
  };
}

function toAnalysedSession(row) {
  return {
    id: row.id, project: row.project,
    startedAt: row.startedAt, endedAt: row.endedAt,
    netTokens: row.netTokens, costUsd: row.costUsd, costComplete: row.costComplete,
    report: JSON.parse(row.reportJson),
  };
}

const toAnalysedSessions = rows => rows.map(toAnalysedSession);

module.exports = { mainModelOf, netOf, toSessionRow, toAnalysedSession, toAnalysedSessions };

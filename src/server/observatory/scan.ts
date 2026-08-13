'use strict';
// Incremental scan orchestration.
//
// netgain re-reads everything on every runDoctor call, by design. Incremental-
// ity is therefore the product's job: discover the sessions, ask the store
// which ones actually changed, and analyse only those — one by one, through
// the granular API.

import { SCAN_VERSION } from './scan-version.ts';
import { toSessionRow } from './session-mapper.ts';

async function runIncrementalScan(deps, options) {
  const { engine, store, broadcast, now } = deps;
  const { claudeDir, sinceDays = 30, maxPrompts = 100, scanVersion = SCAN_VERSION } = options;

  const startedAt = now().toISOString();
  const since = new Date(now().getTime() - sinceDays * 24 * 3600 * 1000);
  const refs = await engine.discoverSessions(claudeDir, { since });

  const outcome = { discovered: refs.length, scanned: 0, skipped: 0, failed: 0, startedAt, endedAt: null };
  broadcast({ type: 'analysisScan', phase: 'start', total: refs.length, scanned: 0, skipped: 0, failed: 0 });

  for (const ref of refs) {
    if (!store.needsScan(ref, scanVersion)) {
      outcome.skipped++;
      continue;
    }
    try {
      const report = await engine.scanSession(ref, maxPrompts);
      // A session the engine could not read is counted and surfaced, never
      // stored as if it were a zero-cost session.
      if (report.skipped !== undefined) {
        outcome.failed++;
      } else {
        store.upsertSession(toSessionRow(report, ref, scanVersion));
        outcome.scanned++;
      }
    } catch {
      outcome.failed++;
    }
    broadcast({
      type: 'analysisScan', phase: 'progress', total: refs.length,
      scanned: outcome.scanned, skipped: outcome.skipped, failed: outcome.failed,
    });
  }

  outcome.endedAt = now().toISOString();
  store.setScanState(claudeDir, outcome.endedAt, String(scanVersion));
  // No 'done' here: that broadcast is the client's reload signal, and the
  // advice is computed after this function returns — the service emits it
  // once the recommendations are stored.
  return outcome;
}

export { runIncrementalScan };

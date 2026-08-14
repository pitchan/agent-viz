'use strict';
// Incremental scan orchestration.
//
// netgain re-reads everything on every runDoctor call, by design. Incremental-
// ity is therefore the product's job: discover the sessions, ask the store
// which ones actually changed, and analyse only those — one by one, through
// the granular API.

import type { SessionRef } from '../../engine/core/discovery.ts';
import type { SessionReport } from '../../engine/doctor/report/types.ts';
import { SCAN_VERSION } from './scan-version.ts';
import { toSessionRow } from './session-mapper.ts';

// SSE broadcast shape of the incremental scan — 'done' is added by the
// service (see service.ts), never emitted here (see the comment at the
// bottom of runIncrementalScan). Shared with service.ts: the second real
// consumer of this exact shape within the lot.
export interface AnalysisScanMessage {
  type: 'analysisScan';
  phase: 'start' | 'progress' | 'done';
  total: number;
  scanned: number;
  skipped: number;
  failed: number;
}

// Only what this module actually calls on the engine — the real Engine
// (engine.ts) is a superset and satisfies this structurally.
interface ScanEngine {
  discoverSessions(claudeDir: string, filters: { since: Date }): Promise<SessionRef[]>;
  scanSession(ref: SessionRef, maxPrompts: number): Promise<SessionReport>;
}

// Only what this module actually calls on the store — the real Store
// (store.ts) is a superset and satisfies this structurally.
interface ScanStore {
  needsScan(ref: SessionRef, scanVersion: number): boolean;
  upsertSession(row: ReturnType<typeof toSessionRow>): void;
  setScanState(claudeDir: string, lastScanAt: string, engineVersion: string): void;
}

interface ScanDeps {
  engine: ScanEngine;
  store: ScanStore;
  broadcast: (message: AnalysisScanMessage) => void;
  now: () => Date;
}

interface ScanOptions {
  claudeDir: string;
  sinceDays?: number;
  maxPrompts?: number;
  scanVersion?: number;
}

interface ScanOutcome {
  discovered: number;
  scanned: number;
  skipped: number;
  failed: number;
  startedAt: string;
  endedAt: string | null;
}

async function runIncrementalScan(deps: ScanDeps, options: ScanOptions): Promise<ScanOutcome> {
  const { engine, store, broadcast, now } = deps;
  const { claudeDir, sinceDays = 30, maxPrompts = 100, scanVersion = SCAN_VERSION } = options;

  const startedAt = now().toISOString();
  const since = new Date(now().getTime() - sinceDays * 24 * 3600 * 1000);
  const refs = await engine.discoverSessions(claudeDir, { since });

  const outcome: ScanOutcome = { discovered: refs.length, scanned: 0, skipped: 0, failed: 0, startedAt, endedAt: null };
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

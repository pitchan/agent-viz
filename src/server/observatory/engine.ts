'use strict';
// Boundary to the netgain analysis engine, injected via `loadEngine()` so
// rules and orchestration stay testable without it.
//
// The engine is not a separate package: its source lives in `src/engine/` and its
// build output ships inside this very package (see `files` in package.json), so
// any install that has the product has the engine.
//
// The import below is static: a missing compiled engine fails the load of this
// module itself. `bin/agent-viz.js` stops earlier on any missing compiled file
// (`ensureBuildIsFresh`) and names the fix.

import path from 'node:path';

import { discoverSessions, parseSince, priceTable } from '../../engine/core/index.ts';
import { scanSession, netTokens } from '../../engine/doctor/index.ts';
import { PRODUCT_VERSION } from '../../engine/version.ts';

export interface Engine {
  discoverSessions: typeof discoverSessions;
  parseSince: typeof parseSince;
  scanSession: typeof scanSession;
  netTokens: typeof netTokens;
  priceTable: typeof priceTable;
  // v0.5.0 surface: the engine version, unified with the product's own (see
  // below) — one tool, one version.
  version: string;
}

export interface EngineStatus {
  ok: boolean;
  error: string | null;
}

const FIXTURE_CLAUDE_DIR = path.join(import.meta.dirname, '..', '..', '..', 'tests', 'fixtures', 'observatory');

let _engine: Engine | null = null;
let _error: string | null = null;
let _pending: Promise<Engine> | null = null;

// The injection seam the rest of the observatory depends on: callers receive
// the engine as a value and never reach into `../../engine/` themselves.
async function loadEngine(): Promise<Engine> {
  if (_engine) return _engine;
  if (!_pending) {
    _pending = (async (): Promise<Engine> => {
      return {
        discoverSessions,
        parseSince,
        scanSession,
        netTokens,
        // v0.5.0 surface: the embedded price table and the engine version, so
        // the product can show the tariff that actually produced its numbers —
        // and the real-time pill can adopt the same table (unification).
        priceTable,
        // One tool, one version: the engine no longer carries its own.
        version: PRODUCT_VERSION,
      };
    })().then(
      engine => { _engine = engine; _error = null; _pending = null; return engine; },
      (err: unknown) => {
        _error = err instanceof Error ? err.message : String(err);
        _pending = null;
        throw err;
      },
    );
  }
  return _pending;
}

// Last known load outcome, without triggering a load.
function engineStatus(): EngineStatus {
  return { ok: _engine !== null, error: _error };
}

export { loadEngine, engineStatus, FIXTURE_CLAUDE_DIR };

'use strict';
// Boundary to the netgain analysis engine, injected via `loadEngine()` so
// rules and orchestration stay testable without it.
//
// The engine is not a separate package: its source lives in `src/engine/` and its
// build output ships inside this very package (see `files` in package.json), so
// any install that has the product has the engine.
//
// A missing engine does NOT surface here. The import below is static: if the
// compiled engine is absent, loading THIS module throws at import time, which
// kills startup in whichever module imports it first — before any advisor
// page or canvas view runs. `bin/agent-viz.js` names that failure earlier
// (`ensureBuildIsFresh`), before `dist/server/` is even loaded.

import path from 'node:path';
import { readFileSync } from 'node:fs';

import { discoverSessions, parseSince, priceTable } from '../../engine/core/index.ts';
import { scanSession, netTokens } from '../../engine/doctor/index.ts';

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
// the engine as a value, never reach into `../../engine/` themselves. The
// engine functions are already resolved above (static import); the async
// work left here is reading the product's own version to stamp onto it.
async function loadEngine(): Promise<Engine> {
  if (_engine) return _engine;
  if (!_pending) {
    _pending = (async (): Promise<Engine> => {
      // BOM retire avant l analyse (constat C1, idiome de hook.js:64). Ce site
      // est le SEUL des trois sans repli : un package.json prefixe ne rendrait
      // pas une version fausse, il ferait echouer le chargement du moteur.
      const pkgBrut = readFileSync(path.join(import.meta.dirname, '..', '..', '..', 'package.json'), 'utf8');
      const pkg: { version: string } = JSON.parse(pkgBrut.charCodeAt(0) === 0xFEFF ? pkgBrut.slice(1) : pkgBrut);
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
        version: pkg.version,
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

// Last known load outcome, without triggering a load. A missing/broken
// engine no longer reaches here (see the header): the only realistic failure
// left is the package.json read above.
function engineStatus(): EngineStatus {
  return { ok: _engine !== null, error: _error };
}

export { loadEngine, engineStatus, FIXTURE_CLAUDE_DIR };

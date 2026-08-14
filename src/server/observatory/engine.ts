'use strict';
// Boundary to the netgain analysis engine (ESM), loaded via dynamic import.
// This is the ONLY module that knows where the engine lives —
// everything downstream receives the engine as a parameter, so rules and
// orchestration stay testable without it.
//
// The engine is not a separate package: its source lives in `src/engine/` and its
// build output ships inside this very package (see `files` in package.json), so
// any install that has the product has the engine. A missing engine therefore
// signals a damaged install or a skipped build, never a normal state — and it
// stays handled: the live canvas view keeps working and the advisor page shows
// the exact error.
//
// The package root carries `{"type":"module"}`: `dist/engine/*.js` already reads
// as ESM, with no subtree marker to write or to ship.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';

// Ruling R8 (doc/36 §4.1): these are `import type` only — erased at emission,
// no execution edge added. The actual load stays the dynamic import() below,
// UNCHANGED (same computed dist/engine path, same runtime shape); this is
// only how the module's own exports get real types instead of the implicit
// `any` a computed-path import() otherwise carries.
import type { discoverSessions, parseSince } from '../../engine/core/index.ts';
import type { priceTable } from '../../engine/core/index.ts';
import type { scanSession, netTokens } from '../../engine/doctor/index.ts';

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
const ENGINE_DIST = path.join(import.meta.dirname, '..', '..', '..', 'dist', 'engine');

// Absolute file URL: the only form of dynamic import that is unambiguous on
// Windows as well as POSIX.
const engineModule = (rel: string): string => pathToFileURL(path.join(ENGINE_DIST, rel)).href;

let _engine: Engine | null = null;
let _error: string | null = null;
let _pending: Promise<Engine> | null = null;

async function loadEngine(): Promise<Engine> {
  if (_engine) return _engine;
  if (!_pending) {
    _pending = (async (): Promise<Engine> => {
      // The import() targets are computed paths, so TS cannot resolve their
      // module shape statically — `core`/`doctor` are implicit `any` here.
      // Channelled below: every field read off them is cast to the REAL type
      // imported above via `import type`, never left as a bare `any`.
      const [core, doctor] = await Promise.all([
        import(engineModule('core/index.js')),
        import(engineModule('doctor/index.js')),
      ]);
      // BOM retire avant l analyse (constat C1, idiome de hook.js:64). Ce site
      // est le SEUL des trois sans repli : un package.json prefixe ne rendrait
      // pas une version fausse, il ferait echouer le chargement du moteur.
      const pkgBrut = readFileSync(path.join(import.meta.dirname, '..', '..', '..', 'package.json'), 'utf8');
      const pkg: { version: string } = JSON.parse(pkgBrut.charCodeAt(0) === 0xFEFF ? pkgBrut.slice(1) : pkgBrut);
      return {
        discoverSessions: core.discoverSessions as typeof discoverSessions,
        parseSince: core.parseSince as typeof parseSince,
        scanSession: doctor.scanSession as typeof scanSession,
        netTokens: doctor.netTokens as typeof netTokens,
        // v0.5.0 surface: the embedded price table and the engine version, so
        // the product can show the tariff that actually produced its numbers —
        // and the real-time pill can adopt the same table (unification).
        priceTable: core.priceTable as typeof priceTable,
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

// Last known load outcome, without triggering a load. Used by the routes so a
// missing engine reports its exact cause instead of an empty page.
function engineStatus(): EngineStatus {
  return { ok: _engine !== null, error: _error };
}

export { loadEngine, engineStatus, FIXTURE_CLAUDE_DIR };

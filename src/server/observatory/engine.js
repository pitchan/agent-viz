'use strict';
// Boundary to the netgain analysis engine (ESM, loaded from CommonJS via
// dynamic import). This is the ONLY module that knows where the engine lives —
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
// `dist/engine/package.json` carries `{"type":"module"}` so Node reads that
// subtree as ESM even though this package is CommonJS. It is no longer a
// versioned file: the build writes it (`scripts/dist-esm-marker.mjs`), and it
// must stay shipped.

const path = require('path');
const { pathToFileURL } = require('url');

const FIXTURE_CLAUDE_DIR = path.join(__dirname, '..', '..', '..', 'tests', 'fixtures', 'observatory');
const ENGINE_DIST = path.join(__dirname, '..', '..', '..', 'dist', 'engine');

// Absolute file URL: the only form of dynamic import that is unambiguous from a
// CommonJS module on Windows as well as POSIX.
const engineModule = rel => pathToFileURL(path.join(ENGINE_DIST, rel)).href;

let _engine = null;
let _error = null;
let _pending = null;

async function loadEngine() {
  if (_engine) return _engine;
  if (!_pending) {
    _pending = (async () => {
      const [core, doctor] = await Promise.all([
        import(engineModule('core/index.js')),
        import(engineModule('doctor/index.js')),
      ]);
      return {
        discoverSessions: core.discoverSessions,
        parseSince: core.parseSince,
        scanSession: doctor.scanSession,
        netTokens: doctor.netTokens,
        // v0.5.0 surface: the embedded price table and the engine version, so
        // the product can show the tariff that actually produced its numbers —
        // and the real-time pill can adopt the same table (unification).
        priceTable: core.priceTable,
        // One tool, one version: the engine no longer carries its own.
        version: require('../../../package.json').version,
      };
    })().then(
      engine => { _engine = engine; _error = null; _pending = null; return engine; },
      err => { _error = err.message; _pending = null; throw err; },
    );
  }
  return _pending;
}

// Last known load outcome, without triggering a load. Used by the routes so a
// missing engine reports its exact cause instead of an empty page.
function engineStatus() {
  return { ok: _engine !== null, error: _error };
}

module.exports = { loadEngine, engineStatus, FIXTURE_CLAUDE_DIR };

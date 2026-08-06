'use strict';
// Boundary to the netgain analysis engine (ESM, loaded from CommonJS via
// dynamic import). This is the ONLY module that knows the engine's package
// name — everything downstream receives the engine as a parameter, so rules
// and orchestration stay testable without it.
//
// The package is a hard dependency (see package.json) and its source lives in
// this repo's `netgain/` workspace, so a normal install always provides it.
// A missing engine therefore signals a damaged install rather than a normal
// state — it stays handled: the live canvas view keeps working and the advisor
// page shows the exact error.

const path = require('path');

const FIXTURE_CLAUDE_DIR = path.join(__dirname, '..', '..', '..', 'tests', 'fixtures', 'observatory');

let _engine = null;
let _error = null;
let _pending = null;

async function loadEngine() {
  if (_engine) return _engine;
  if (!_pending) {
    _pending = (async () => {
      const [core, doctor] = await Promise.all([
        import('@vcueto/netgain/core'),
        import('@vcueto/netgain/doctor'),
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
        version: require('@vcueto/netgain/package.json').version,
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

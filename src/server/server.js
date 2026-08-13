#!/usr/bin/env node
'use strict';
// agent-viz HTTP server entry point — boot wiring only.
//
// Owns: port binding, shutdown of any prior instance, the initial scan +
// periodic housekeep schedule, and the fs.watch on the events dir that
// promotes newly-arriving .jsonl files into sessionIndex.
//
// Everything else (request handling, session bookkeeping, transcript
// tailing, token tracking, file reading) lives in src/server/*.js.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

import {
  DIR,
  sessionIndex,
  idFromPath,
} from './session-index.js';
import { broadcastSessionsChanged, broadcastSSE } from './sse.js';
import { watchSession, liveHandoffOffset } from './event-reader.js';
import { housekeep, scanAndWatch } from './housekeep.js';
import { dispatch, setServer } from './routes.js';
import { startPricingRefresh, applyEnginePrices, onPricingDrift } from './pricing.js';
import { getObservatoryService } from './observatory/index.js';
import { startWatchdog } from './watchdog/index.js';
import { loadEngine } from './observatory/engine.js';

const PORT = process.env.PORT || 3333;

// Watch the events dir for new session files (filling sessionIndex live).
fs.watch(DIR, (_, filename) => {
  if (!filename || !filename.endsWith('.jsonl')) return;
  const fp = path.join(DIR, filename);
  if (fs.existsSync(fp)) {
    const id = idFromPath(fp);
    const isNew = !sessionIndex.has(id);
    if (isNew) {
      sessionIndex.set(id, {
        id, promptCache: undefined, promptWindow: 0,
        eventCount: 0, size: 0, mtime: Date.now(),
        agentSource: undefined,
      });
      broadcastSessionsChanged();
    }
    watchSession(fp);
  }
});

// Try to gracefully stop any prior agent-viz on the same port, then fall back
// to OS-level kill via netstat + taskkill (Windows).
async function killOldServer() {
  const shutdownOk = await new Promise(resolve => {
    const req = http.request({ hostname: '127.0.0.1', port: PORT, path: '/shutdown', method: 'POST', timeout: 2000 }, res => {
      res.resume();
      res.on('end', () => resolve(true));
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end();
  });
  if (shutdownOk) { await new Promise(r => setTimeout(r, 500)); return; }
  try {
    const out = execSync(`netstat -ano | findstr ":${PORT}" | findstr "LISTEN"`, { encoding: 'utf8', timeout: 3000 });
    const match = out.match(/LISTENING\s+(\d+)/);
    if (match) {
      try { execSync(`taskkill /PID ${match[1]} /F`, { timeout: 3000 }); } catch {}
      await new Promise(r => setTimeout(r, 1000));
    }
  } catch {}
}

function startServer() {
  // No CORS header: the server bind is loopback-only and the UI is same-origin.
  // A wildcard would let any visited site read transcripts from localhost.
  const server = http.createServer((req, res) => {
    dispatch(req, res).catch(err => {
      console.error('[server] dispatch error:', err && err.message);
      try { res.writeHead(500); res.end('internal error'); } catch {}
    });
  });
  setServer(server);
  // Bind to loopback only — never expose transcripts to the LAN.
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`agent-viz listening on http://localhost:${PORT}`);
  });
}

killOldServer().then(async () => {
  // UNIFICATION (2026-08-05): the engine's embedded table prices the whole
  // product, real-time pill included. Missing engine = normal, the FALLBACK
  // mirror (proven identical by test) applies. Fire-and-forget: pricing must
  // not block boot.
  loadEngine()
    .then(engine => applyEnginePrices(engine.priceTable()))
    .catch(() => console.log('[pricing] engine absent — static mirror table in use'));
  // LiteLLM is a watchdog now: drift reports surface on the SSE stream and in
  // the alerts popup; it never writes prices.
  onPricingDrift(report => broadcastSSE({ type: 'pricingDrift', drifts: report.drifts }));
  startPricingRefresh();
  await scanAndWatch();
  // Purge old/empty sessions + compact large files on boot.
  await housekeep();
  // Analysis scan: fire-and-forget so a large first scan never delays the
  // dashboard, and a missing engine never prevents the server from starting.
  const runAnalysisScan = () => getObservatoryService().scan()
    .catch(err => console.error('[observatory] scan failed:', err.message));
  runAnalysisScan();
  // Re-run every hour.
  setInterval(() => housekeep().catch(err => console.error('[housekeep] hourly run failed:', err.message)), 3600_000);
  setInterval(runAnalysisScan, 3600_000);
  // The watchdog: instance, then catch-up on what happened while the server
  // was down, then the heartbeat. The sequence and its order live in
  // server/watchdog, where they can be exercised by tests; what is decided
  // HERE is what belongs to the server alone — the events dir (DIR, the one
  // authoritative definition), the SSE envelope, and the hand-off offset that
  // stops the sweep where the live reader takes over. Without that last one
  // both paths read the same bytes and the detector counts every event twice.
  await startWatchdog({
    dir: DIR,
    liveFrom: liveHandoffOffset,
    broadcastAlert: alert => broadcastSSE({ type: 'alert', alert }),
  });
  startServer();
});

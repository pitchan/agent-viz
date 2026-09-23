#!/usr/bin/env node
'use strict';
// agent-viz HTTP server entry point — boot wiring only.
//
// Owns: port binding (an occupied port is never freed by force), the initial
// scan + periodic housekeep schedule, and the fs.watch on the events dir that
// promotes newly-arriving .jsonl files into sessionIndex.
//
// Everything else (request handling, session bookkeeping, transcript
// tailing, token tracking, file reading) lives in src/server/*.ts.

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  DIR,
  sessionIndex,
  idFromPath,
} from './session-index.ts';
import { broadcastSessionsChanged, broadcastSSE } from './sse.ts';
import { watchSession, liveHandoffOffset } from './event-reader.ts';
import { housekeep, scanAndWatch } from './housekeep.ts';
import { dispatch, setServer } from './routes.ts';
import { startPricingRefresh, onPricingDrift } from './pricing.ts';
import { applyAdoptedPrices } from './pricing-state.ts';
import { adoptedPricesPath, readAdoptedPrices } from '../engine/core/adopted-prices.ts';
import { getObservatoryService } from './observatory/index.ts';
import { startWatchdog } from './watchdog/index.ts';
import { bindPort, portInUseMessage } from './bind-port.ts';

const PORT = Number(process.env.PORT || 3333);

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

async function startServer(): Promise<void> {
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
  const outcome = await bindPort(server, PORT);
  if (!outcome.bound) {
    console.error(portInUseMessage(PORT));
    process.exit(1);
  }
  console.log(`agent-viz listening on http://localhost:${PORT}`);
}

async function boot(): Promise<void> {
  // Les prix adoptés précèdent tout calcul de coût : pastille, vigie et observatoire.
  applyAdoptedPrices(await readAdoptedPrices(adoptedPricesPath(os.homedir()), fs.promises.readFile));
  // LiteLLM is a watchdog: drift reports surface on the SSE stream and in
  // the alerts popup; it never writes prices.
  onPricingDrift(report => broadcastSSE({ type: 'pricingDrift', drifts: report.drifts }));
  startPricingRefresh();
  await scanAndWatch();
  // Purge old/empty sessions + compact large files on boot.
  await housekeep();
  // Analysis scan: fire-and-forget so a large first scan never delays the
  // dashboard, and a failed scan is logged without stopping the server.
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
  await startServer();
}

boot();

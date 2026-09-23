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
  await scanAndWatch();
  // Purge old/empty sessions + compact large files on boot.
  await housekeep();
  // Analysis scan: fire-and-forget so a large first scan never delays the
  // dashboard, and a failed scan is logged without stopping the server.
  const runAnalysisScan = () => getObservatoryService().scan()
    .catch(err => console.error('[observatory] scan failed:', err.message));
  // La vigie des tarifs passe avant le premier scan : un tarif qu'elle applique
  // chiffre déjà ce scan. Hors ligne, la cause est journalisée et rien ne change.
  const checkPrices = () => getObservatoryService().checkPrices()
    .then(r => {
      if (r.failure) console.log('[pricing] vigie :', r.failure);
      for (const a of r.adopted) console.log('[pricing] tarif Anthropic appliqué :', a.model);
      for (const e of r.errors) console.error('[pricing] tarif non appliqué :', e.model, e.message);
    })
    .catch(err => console.error('[pricing] vigie :', err.message));
  checkPrices().finally(runAnalysisScan);
  setInterval(checkPrices, 24 * 3600_000);
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

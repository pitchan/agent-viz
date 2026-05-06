#!/usr/bin/env node
'use strict';
// agent-viz HTTP server entry point — boot wiring only.
//
// Owns: port binding, shutdown of any prior instance, the initial scan +
// periodic housekeep schedule, and the fs.watch on the events dir that
// promotes newly-arriving .jsonl files into sessionIndex.
//
// Everything else (request handling, session bookkeeping, transcript
// tailing, token tracking, file reading) lives in lib/server/*.js.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const {
  DIR,
  sessionIndex,
  idFromPath,
} = require('./server/session-index');
const { broadcastSessionsChanged } = require('./server/sse');
const { watchSession } = require('./server/event-reader');
const { housekeep, scanAndWatch } = require('./server/housekeep');
const { dispatch, setServer } = require('./server/routes');
const { startPricingRefresh } = require('./server/pricing');

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
  // Fire-and-forget: pricing fetch must not block boot. Static fallback in
  // pricing.js means cost calc works even if this never resolves.
  startPricingRefresh();
  await scanAndWatch();
  // Purge old/empty sessions + compact large files on boot.
  await housekeep();
  // Re-run every hour.
  setInterval(() => housekeep().catch(() => {}), 3600_000);
  startServer();
});

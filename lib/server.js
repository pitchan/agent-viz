#!/usr/bin/env node
'use strict';
// agent-viz HTTP server entry point.
//
// Wiring + HTTP routing only. Heavy lifting lives in:
//   lib/server/session-index.js — in-memory session registry, path validation
//   lib/server/sse.js           — SSE clients + broadcast
//   lib/server/tokens.js        — per-session token tracking
//   lib/server/transcript.js    — first-prompt scan + transcript tailing
//   lib/server/event-reader.js  — JSONL tail reader + fs.watch glue
//   lib/server/housekeep.js     — purge / compact / lazy-watch / boot scan

const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { execSync } = require('child_process');

const {
  DIR, LEGACY_DIR,
  sessionIndex,
  sessionFilePath, validSessionId, latestSession,
  idFromPath,
  sessionDirs,
} = require('./server/session-index');
const { sseClients, broadcastSSE, broadcastSessionsChanged } = require('./server/sse');
const { tokensSnapshot } = require('./server/tokens');
const { ensureFirstPrompt } = require('./server/transcript');
const {
  readAndBroadcast, watchSession, deleteSession,
} = require('./server/event-reader');
const { housekeep, scanAndWatch } = require('./server/housekeep');

const PORT = process.env.PORT || 3333;
const PROJECT_ROOT = path.join(__dirname, '..');
const HTML = path.join(PROJECT_ROOT, 'index.html');

// Reject cross-origin POSTs to destructive endpoints. CLI/programmatic callers
// (lifecycle.js, curl) have no Origin header and are allowed; browsers always
// send Origin on cross-origin requests, so a malicious site can't hit /shutdown
// or /events?clear from a tab in another origin.
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  return origin === `http://localhost:${PORT}` || origin === `http://127.0.0.1:${PORT}`;
}

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
      sessionDirs.set(id, DIR);
      broadcastSessionsChanged();
    }
    watchSession(fp);
  }
});

// --- Startup: kill old server ---
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

let server;

function startServer() {
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');

    // No CORS header: the server bind is loopback-only and the UI is same-origin.
    // A wildcard would let any visited site read transcripts from localhost.

    // Instant push from hook.js — bypasses fs.watch latency.
    if (url.pathname === '/notify' && req.method === 'POST') {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', async () => {
        try {
          const { session } = JSON.parse(body);
          // Validate before path.join — a crafted id could otherwise trigger a
          // read of an arbitrary .jsonl on disk and broadcast its contents.
          if (session && validSessionId(session)) {
            const fp = sessionFilePath(session);
            try { await fsp.access(fp); } catch { res.writeHead(200); res.end('ok'); return; }
            watchSession(fp);
            readAndBroadcast(fp);
          }
        } catch {}
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('ok');
      });
      return;
    }

    if (url.pathname === '/shutdown') {
      // Destructive: require POST + same-origin (or no Origin = CLI).
      if (req.method !== 'POST' || !sameOrigin(req)) {
        res.writeHead(405, { 'Content-Type': 'text/plain' });
        res.end('method not allowed');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('bye');
      setTimeout(() => { server.close(); process.exit(0); }, 100);
      return;
    }

    // Serve static ES modules from /public. No directory traversal.
    if (req.method === 'GET' && url.pathname.startsWith('/public/')) {
      const safe = url.pathname.replace(/\.\.+/g, '');
      const p = path.join(PROJECT_ROOT, safe);
      const root = path.join(PROJECT_ROOT, 'public');
      if (p.startsWith(root + path.sep) || p === root) {
        try {
          const data = await fsp.readFile(p);
          res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
          res.end(data);
        } catch {
          res.writeHead(404);
          res.end('Not found');
        }
        return;
      }
    }

    if (url.pathname === '/' || url.pathname === '/index.html') {
      try {
        const html = await fsp.readFile(HTML);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
      } catch {
        res.writeHead(500);
        res.end('index.html missing');
      }
      return;
    }

    // SSE endpoint
    if (url.pathname === '/stream') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      res.write(':ok\n\n');
      sseClients.add(res);
      // Replay current token snapshots so a fresh client sees state immediately.
      for (const [sid, rec] of sessionIndex) {
        const snap = tokensSnapshot(rec);
        if (snap) {
          try {
            res.write(`data: ${JSON.stringify({ type: 'tokens', session: sid, main: snap.main, perAgent: snap.perAgent })}\n\n`);
          } catch {}
        }
      }
      req.on('close', () => sseClients.delete(res));
      return;
    }

    if (url.pathname === '/events') {
      if (url.searchParams.has('clear')) {
        // Destructive: require POST + same-origin. Blocks <img>/CSRF tricks.
        if (req.method !== 'POST' || !sameOrigin(req)) {
          res.writeHead(405, { 'Content-Type': 'text/plain' });
          res.end('method not allowed');
          return;
        }
        const sid = url.searchParams.get('clear');
        try {
          if (sid && sid !== '1') {
            // Validate sid format to block path traversal via crafted IDs.
            if (!validSessionId(sid)) {
              res.writeHead(400, { 'Content-Type': 'text/plain' });
              res.end('invalid session id');
              return;
            }
            await deleteSession(sessionFilePath(sid));
          } else {
            for (const dir of [DIR, LEGACY_DIR]) {
              let files;
              try { files = (await fsp.readdir(dir)).filter(f => f.endsWith('.jsonl')); }
              catch { continue; }
              for (const f of files) await deleteSession(path.join(dir, f));
            }
          }
          broadcastSessionsChanged();
        } catch {}
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('cleared');
        return;
      }

      const sessionParam = url.searchParams.get('session');
      if (sessionParam && !validSessionId(sessionParam)) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('invalid session id');
        return;
      }
      const offset = parseInt(url.searchParams.get('offset') || '0', 10);
      const sessionFile = sessionParam
        ? sessionFilePath(sessionParam)
        : latestSession();

      let data = '', size = 0, sessionId = '';
      if (sessionFile) {
        sessionId = path.basename(sessionFile, '.jsonl');
        let fh;
        try {
          const stat = await fsp.stat(sessionFile);
          size = stat.size;
          if (offset < size) {
            const len = size - offset;
            const buf = Buffer.alloc(len);
            fh = await fsp.open(sessionFile, 'r');
            await fh.read(buf, 0, len, offset);
            await fh.close();
            fh = null;
            data = buf.toString('utf8');
          }
        } catch {
          if (fh) { try { await fh.close(); } catch {} }
        }
      }
      res.writeHead(200, {
        'Content-Type': 'application/x-ndjson',
        'Cache-Control': 'no-cache',
        'X-File-Size': String(size),
        'X-Session-Id': sessionId,
        'Access-Control-Expose-Headers': 'X-File-Size, X-Session-Id',
      });
      res.end(data);
      return;
    }

    // Summary for compacted sessions — serves the .summary.json if it exists.
    if (url.pathname === '/summary') {
      const sid = url.searchParams.get('session');
      if (!sid) { res.writeHead(400); res.end('missing session'); return; }
      if (!validSessionId(sid)) { res.writeHead(400); res.end('invalid session id'); return; }
      const dir = sessionDirs.get(sid) || DIR;
      const summaryPath = path.join(dir, sid + '.summary.json');
      try {
        const data = await fsp.readFile(summaryPath, 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(data);
      } catch {
        res.writeHead(404);
        res.end('no summary');
      }
      return;
    }

    if (url.pathname === '/sessions') {
      // Optional forced rescan — rebuild index from disk. Useful if the user
      // deleted files outside the app or suspects drift.
      if (url.searchParams.has('rescan')) {
        sessionIndex.clear();
        await scanAndWatch();
      }
      // Warm any not-yet-attempted prompt caches in parallel (fire-and-forget
      // after the response so the client gets a fast reply).
      const missing = [];
      for (const rec of sessionIndex.values()) {
        if (rec.promptCache === undefined) missing.push(rec.id);
      }
      // Check which sessions have a .summary.json (compacted).
      const summarySet = new Set();
      try {
        const allFiles = await fsp.readdir(DIR);
        for (const f of allFiles) {
          if (f.endsWith('.summary.json')) summarySet.add(f.replace('.summary.json', ''));
        }
      } catch {}
      const sessions = [...sessionIndex.values()]
        .map(rec => ({
          id: rec.id,
          prompt: (typeof rec.promptCache === 'string') ? rec.promptCache : null,
          eventCount: rec.eventCount,
          size: rec.size,
          mtime: rec.mtime,
          compacted: summarySet.has(rec.id),
          agentSource: rec.agentSource || 'claude',
        }))
        .sort((a, b) => b.mtime - a.mtime);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(sessions));
      // Background: resolve missing prompts, then broadcast a single refresh.
      if (missing.length) {
        (async () => {
          for (const id of missing) {
            await ensureFirstPrompt(path.join(DIR, id + '.jsonl')).catch(() => {});
          }
        })();
      }
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  // Bind to loopback only — never expose transcripts to the LAN.
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`agent-viz listening on http://localhost:${PORT}`);
  });
}

killOldServer().then(async () => {
  await scanAndWatch();
  // Purge old/empty sessions + compact large files on boot.
  await housekeep();
  // Re-run every hour.
  setInterval(() => housekeep().catch(() => {}), 3600_000);
  startServer();
});

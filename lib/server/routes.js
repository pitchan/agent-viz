'use strict';
// HTTP route table — declarative dispatch with same-origin guards.
//
// Each route declares { method, path|prefix, handler, sameOrigin? }. Adding
// a new endpoint is one line in ROUTES; security checks are co-located with
// the route declaration so they can't be forgotten.

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const {
  DIR,
  sessionIndex,
  sessionFilePath, validSessionId, latestSession,
} = require('./session-index');
const { sseClients, broadcastSessionsChanged } = require('./sse');
const { tokensSnapshot } = require('./tokens');
const { ensureFirstPrompt } = require('./transcript');
const {
  readAndBroadcast, watchSession, deleteSession,
} = require('./event-reader');
const { scanAndWatch } = require('./housekeep');

const PORT = process.env.PORT || 3333;
const PROJECT_ROOT = path.join(__dirname, '..', '..');
const HTML = path.join(PROJECT_ROOT, 'index.html');

// HTTP server reference for graceful shutdown — wired by server.js once the
// instance has been created. Without this, /shutdown would have to live in
// server.js itself.
let _server = null;
function setServer(s) { _server = s; }

// Reject cross-origin POSTs to destructive endpoints. CLI/programmatic callers
// (lifecycle.js, curl) have no Origin header and are allowed; browsers always
// send Origin on cross-origin requests, so a malicious site can't hit /shutdown
// or /events?clear from a tab in another origin.
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  return origin === `http://localhost:${PORT}` || origin === `http://127.0.0.1:${PORT}`;
}

// ─── Handlers ──────────────────────────────────────────────────────────────

// Instant push from hook.js — bypasses fs.watch latency.
function notifyHandler(req, res) {
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
}

function shutdownHandler(_req, res) {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('bye');
  setTimeout(() => {
    if (_server) { try { _server.close(); } catch {} }
    process.exit(0);
  }, 100);
}

const STATIC_MIME = {
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

async function staticHandler(_req, res, url) {
  // No directory traversal: strip ".." segments before resolving.
  const safe = url.pathname.replace(/\.\.+/g, '');
  const p = path.join(PROJECT_ROOT, safe);
  const root = path.join(PROJECT_ROOT, 'public');
  if (!(p.startsWith(root + path.sep) || p === root)) {
    res.writeHead(404); res.end('Not found'); return;
  }
  try {
    const data = await fsp.readFile(p);
    const mime = STATIC_MIME[path.extname(p).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}

async function indexHandler(_req, res) {
  try {
    const html = await fsp.readFile(HTML);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  } catch {
    res.writeHead(500);
    res.end('index.html missing');
  }
}

function streamHandler(req, res) {
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
}

async function eventsGetHandler(_req, res, url) {
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
}

async function eventsClearHandler(_req, res, url) {
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
      let files;
      try { files = (await fsp.readdir(DIR)).filter(f => f.endsWith('.jsonl')); }
      catch { files = []; }
      for (const f of files) await deleteSession(path.join(DIR, f));
    }
    broadcastSessionsChanged();
  } catch {}
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('cleared');
}

async function summaryHandler(_req, res, url) {
  const sid = url.searchParams.get('session');
  if (!sid) { res.writeHead(400); res.end('missing session'); return; }
  if (!validSessionId(sid)) { res.writeHead(400); res.end('invalid session id'); return; }
  const summaryPath = path.join(DIR, sid + '.summary.json');
  try {
    const data = await fsp.readFile(summaryPath, 'utf8');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('no summary');
  }
}

async function sessionsHandler(_req, res, url) {
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
}

// ─── Route table ──────────────────────────────────────────────────────────
const ROUTES = [
  { method: 'POST', path: '/notify',     handler: notifyHandler },
  { method: 'POST', path: '/shutdown',   handler: shutdownHandler, sameOrigin: true },
  { method: 'GET',  prefix: '/public/',  handler: staticHandler },
  { method: 'GET',  path: '/',           handler: indexHandler },
  { method: 'GET',  path: '/index.html', handler: indexHandler },
  { method: 'GET',  path: '/stream',     handler: streamHandler },
  { method: 'GET',  path: '/events',     handler: eventsGetHandler },
  { method: 'POST', path: '/events',     handler: eventsClearHandler, sameOrigin: true },
  { method: 'GET',  path: '/summary',    handler: summaryHandler },
  { method: 'GET',  path: '/sessions',   handler: sessionsHandler },
];

function pathMatches(route, pathname) {
  if (route.path !== undefined) return route.path === pathname;
  if (route.prefix !== undefined) return pathname.startsWith(route.prefix);
  return false;
}

// Find route, run guards, dispatch. 404 for unknown path, 405 for known path
// without a matching method or with a failed sameOrigin guard.
async function dispatch(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const pathHits = ROUTES.filter(r => pathMatches(r, url.pathname));
  if (pathHits.length === 0) {
    res.writeHead(404); res.end('Not found'); return;
  }
  const route = pathHits.find(r => r.method === req.method);
  if (!route) {
    res.writeHead(405, { 'Content-Type': 'text/plain' });
    res.end('method not allowed');
    return;
  }
  if (route.sameOrigin && !sameOrigin(req)) {
    res.writeHead(405, { 'Content-Type': 'text/plain' });
    res.end('method not allowed');
    return;
  }
  return route.handler(req, res, url);
}

module.exports = { dispatch, setServer, ROUTES };

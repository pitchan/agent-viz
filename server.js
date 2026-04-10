#!/usr/bin/env node
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = process.env.PORT || 3333;
const HTML = path.join(__dirname, 'index.html');
const DIR = path.join(os.tmpdir(), 'claude-events');
try { fs.mkdirSync(DIR, { recursive: true }); } catch {}

const { execSync } = require('child_process');

// --- SSE clients ---
const sseClients = new Set();

function broadcastSSE(data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try { res.write(msg); } catch { sseClients.delete(res); }
  }
}

// --- File watcher: push new events via SSE ---
const watchers = new Map();
const fileOffsets = new Map();

// Read new bytes from a session file and broadcast via SSE
function readAndBroadcast(filePath) {
  try {
    const newStat = fs.statSync(filePath);
    const offset = fileOffsets.get(filePath) || 0;
    if (newStat.size <= offset) return;
    const buf = Buffer.alloc(newStat.size - offset);
    const fd = fs.openSync(filePath, 'r');
    fs.readSync(fd, buf, 0, buf.length, offset);
    fs.closeSync(fd);
    fileOffsets.set(filePath, newStat.size);
    const lines = buf.toString('utf8').trim().split('\n');
    for (const line of lines) {
      try {
        const evt = JSON.parse(line);
        broadcastSSE({ type: 'event', session: path.basename(filePath, '.jsonl'), event: evt });
      } catch {}
    }
  } catch {}
}

const debounceTimers = new Map();

function watchSession(filePath) {
  if (watchers.has(filePath)) return;
  const stat = fs.statSync(filePath);
  fileOffsets.set(filePath, stat.size);

  const watcher = fs.watch(filePath, () => {
    // Debounce 50ms — Windows fires multiple change events per write
    if (debounceTimers.has(filePath)) clearTimeout(debounceTimers.get(filePath));
    debounceTimers.set(filePath, setTimeout(() => {
      debounceTimers.delete(filePath);
      readAndBroadcast(filePath);
    }, 50));
  });
  watchers.set(filePath, watcher);
}

// Watch existing files + new files
function scanAndWatch() {
  try {
    const files = fs.readdirSync(DIR).filter(f => f.endsWith('.jsonl'));
    for (const f of files) watchSession(path.join(DIR, f));
  } catch {}
}
scanAndWatch();
fs.watch(DIR, (_, filename) => {
  if (filename && filename.endsWith('.jsonl')) {
    const fp = path.join(DIR, filename);
    if (fs.existsSync(fp)) watchSession(fp);
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

// Read transcript path from first event in session file
function getTranscriptPath(sessionFile) {
  try {
    const fd = fs.openSync(sessionFile, 'r');
    const buf = Buffer.alloc(4096);
    fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    const firstLine = buf.toString('utf8').split('\n')[0];
    const evt = JSON.parse(firstLine);
    return evt.transcript_path || null;
  } catch {}
  return null;
}

// Strip tagged blocks (<tag>content</tag>) and standalone tags, then trim
function cleanUserText(raw) {
  return raw.replace(/<(\w[\w-]*)[\s>][\s\S]*?<\/\1>/g, '').replace(/<[^>]+>/g, '').trim();
}

// Check if text is IDE/system noise rather than a real user prompt
function isNoise(text) {
  return /^(The user (opened|is viewing|has selected|scrolled)|ide_selection|gitStatus:|Current branch:)/i.test(text);
}

// Get first real user prompt (skips IDE/system noise)
function getFirstPrompt(sessionFile) {
  const tp = getTranscriptPath(sessionFile);
  if (!tp || !fs.existsSync(tp)) return null;
  try {
    const content = fs.readFileSync(tp, 'utf8');
    const lines = content.split('\n');
    for (const line of lines) {
      try {
        const o = JSON.parse(line);
        if (o.type === 'user' || o.type === 'human') {
          const c = o.message?.content || o.content;
          if (typeof c === 'string') {
            const clean = cleanUserText(c);
            if (clean && clean.length > 5 && !isNoise(clean)) return clean.slice(0, 120);
          }
          if (Array.isArray(c)) {
            for (const block of c) {
              if (block.type === 'text') {
                const text = cleanUserText(block.text);
                if (text && text.length > 5 && !text.startsWith('{') && !isNoise(text)) return text.slice(0, 120);
              }
            }
          }
        }
      } catch {}
    }
  } catch {}
  return null;
}

function latestSession() {
  try {
    const files = fs.readdirSync(DIR).filter(f => f.endsWith('.jsonl'));
    if (!files.length) return null;
    let latest = null, latestMtime = 0;
    for (const f of files) {
      const fp = path.join(DIR, f);
      const mt = fs.statSync(fp).mtimeMs;
      if (mt > latestMtime) { latestMtime = mt; latest = fp; }
    }
    return latest;
  } catch { return null; }
}

let server;

function startServer() {
  server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');

    // CORS for SSE
    res.setHeader('Access-Control-Allow-Origin', '*');

    // Instant push from hook.js — bypasses fs.watch latency
    if (url.pathname === '/notify' && req.method === 'POST') {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        try {
          const { session } = JSON.parse(body);
          if (session) {
            const fp = path.join(DIR, `${session}.jsonl`);
            if (fs.existsSync(fp)) {
              if (!watchers.has(fp)) watchSession(fp);
              readAndBroadcast(fp);
            }
          }
        } catch {}
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('ok');
      });
      return;
    }

    if (url.pathname === '/shutdown') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('bye');
      setTimeout(() => { server.close(); process.exit(0); }, 100);
      return;
    }

    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fs.readFileSync(HTML));
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
      req.on('close', () => sseClients.delete(res));
      return;
    }

    if (url.pathname === '/events') {
      if (url.searchParams.has('clear')) {
        const sid = url.searchParams.get('clear');
        try {
          if (sid && sid !== '1') {
            const fp = path.join(DIR, sid + '.jsonl');
            fs.unlinkSync(fp);
            const w = watchers.get(fp);
            if (w) { w.close(); watchers.delete(fp); fileOffsets.delete(fp); }
          } else {
            const files = fs.readdirSync(DIR).filter(f => f.endsWith('.jsonl'));
            for (const f of files) {
              const fp = path.join(DIR, f);
              try { fs.unlinkSync(fp); } catch {}
              const w = watchers.get(fp);
              if (w) { w.close(); watchers.delete(fp); fileOffsets.delete(fp); }
            }
          }
        } catch {}
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('cleared');
        return;
      }

      const offset = parseInt(url.searchParams.get('offset') || '0', 10);
      const sessionFile = url.searchParams.get('session')
        ? path.join(DIR, url.searchParams.get('session') + '.jsonl')
        : latestSession();

      let data = '', size = 0, sessionId = '';
      if (sessionFile) {
        sessionId = path.basename(sessionFile, '.jsonl');
        try {
          const stat = fs.statSync(sessionFile);
          size = stat.size;
          if (offset < size) {
            const buf = Buffer.alloc(size - offset);
            const fd = fs.openSync(sessionFile, 'r');
            fs.readSync(fd, buf, 0, buf.length, offset);
            fs.closeSync(fd);
            data = buf.toString('utf8');
          }
        } catch {}
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

    if (url.pathname === '/sessions') {
      const sessions = [];
      try {
        const files = fs.readdirSync(DIR).filter(f => f.endsWith('.jsonl'));
        for (const f of files) {
          const fp = path.join(DIR, f);
          const stat = fs.statSync(fp);
          const id = f.replace('.jsonl', '');
          const prompt = getFirstPrompt(fp);
          // Count events
          let eventCount = 0;
          try {
            const content = fs.readFileSync(fp, 'utf8');
            eventCount = content.trim().split('\n').length;
          } catch {}
          sessions.push({ id, prompt, eventCount, size: stat.size, mtime: stat.mtimeMs });
        }
        sessions.sort((a, b) => b.mtime - a.mtime);
      } catch {}
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(sessions));
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  server.listen(PORT, () => {
    console.log(`agent-viz listening on http://localhost:${PORT}`);
  });
}

killOldServer().then(startServer);

'use strict';
// HTTP route table — declarative dispatch with same-origin guards.
//
// Each route declares { method, path|prefix, handler, sameOrigin? }. Adding
// a new endpoint is one line in ROUTES; security checks are co-located with
// the route declaration so they can't be forgotten.

import fs from 'node:fs';
const fsp = fs.promises;
import path from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import type { IncomingMessage, ServerResponse, Server } from 'node:http';

import {
  DIR,
  sessionIndex,
  sessionFilePath, validSessionId, latestSession,
} from './session-index.ts';
import { sseClients, broadcastSessionsChanged } from './sse.ts';
import { tokensMessage } from './tokens.ts';
import { ensureFirstPrompt } from './transcript.ts';
import {
  readAndBroadcast, watchSession, deleteSession,
} from './event-reader.ts';
import { rescanSessions } from './housekeep.ts';
import { sameOrigin, localHost } from './request-guards.ts';
import { createObservatoryRoutes } from './observatory/routes.ts';
import { getObservatoryService } from './observatory/index.ts';
import { createWatchdogRoutes } from './watchdog/routes.ts';
import { getWatchdogService } from './watchdog/index.ts';
import { PRODUCT_VERSION } from '../engine/version.ts';

// Un objet exploitable par accès de champ — même garde locale que les autres
// fichiers du serveur : `JSON.parse` ne promet qu'un JSON valide, pas un objet.
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// Bridge vers la signature publique de `tokens.ts` : sa forme privée
// (`TokensCarrier`) n'est pas exportée, `Parameters<...>` l'emprunte sans la
// nommer — même geste que transcript.ts et event-reader.ts. `rec` (Map alimentée par `tokens.ts` lui-même via
// `ensureTokens`) porte réellement cette forme à l'exécution.
type TokensCarrierLike = Parameters<typeof tokensMessage>[1];

// La table de routage telle que ce fichier la déclare : chaque entrée locale
// mêle handlers synchrones et asynchrones, donc `void | Promise<void>`. Les deux tables
// importées (`createWatchdogRoutes`, `createObservatoryRoutes`) déclarent
// leurs propres types de requête/réponse localement (interfaces minimales,
// zéro dépendance) — `IncomingMessage`/`ServerResponse` les satisfont
// structurellement, donc leurs tableaux s'assignent ici sans cast.
interface Route {
  method: string;
  path?: string;
  prefix?: string;
  sameOrigin?: boolean;
  handler: (req: IncomingMessage, res: ServerResponse, url: URL) => void | Promise<void>;
}

const PROJECT_ROOT = path.join(import.meta.dirname, '..', '..');
const HTML = path.join(PROJECT_ROOT, 'index.html');

// HTTP server reference for graceful shutdown — wired by server.ts once the
// instance has been created. Without this, /shutdown would have to live in
// server.ts itself.
let _server: Server | null = null;
function setServer(s: Server): void { _server = s; }

// ─── Handlers ──────────────────────────────────────────────────────────────

// hook.ts sends `{"session":"<id>"}` and nothing else: anything beyond this
// is not a notification, and must not be buffered.
const NOTIFY_MAX_BYTES = 4096;

// Instant push from hook.ts — bypasses fs.watch latency.
function notifyHandler(req: IncomingMessage, res: ServerResponse): void {
  let body = '';
  let received = 0;
  let refused = false;
  // `'data'` sur `IncomingMessage` (aucun encodage posé) rend TOUJOURS un
  // `Buffer` à l'exécution ; `string` reste dans l'union par fidélité au type
  // d'événement du flux.
  req.on('data', (c: Buffer | string) => {
    if (refused) return;
    received += c.length;
    if (received > NOTIFY_MAX_BYTES) {
      refused = true;
      body = '';
      res.writeHead(413, { 'Content-Type': 'text/plain' });
      res.end('body too large');
      return;
    }
    body += typeof c === 'string' ? c : c.toString('utf8');
  });
  req.on('end', async () => {
    if (refused) return;
    try {
      const parsed: unknown = JSON.parse(body);
      const session = isRecord(parsed) ? parsed.session : undefined;
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

function shutdownHandler(_req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('bye');
  setTimeout(() => {
    if (_server) { try { _server.close(); } catch {} }
    process.exit(0);
  }, 100);
}

const STATIC_MIME: Record<string, string> = {
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.ts': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

// Distingue un retrait de types raté d'un fichier absent : `staticHandler`
// répond 500 avec le nom du fichier pour l'un, 404 muet (comportement déjà
// en place) pour l'autre.
class TypeStripError extends Error {}

// Lit un fichier statique et retire ses types s'il finit en `.ts`, avant que
// quiconque le serve. Prend un chemin absolu, pas une requête, pour être
// testée sans passer par la garde de confinement de `staticHandler`.
async function readStaticFile(absPath: string): Promise<{ mime: string; body: Buffer }> {
  const data = await fsp.readFile(absPath);
  const ext = path.extname(absPath).toLowerCase();
  const mime = STATIC_MIME[ext] || 'application/octet-stream';
  if (ext !== '.ts') return { mime, body: data };
  try {
    // Mode `strip`, jamais `transform` : les positions ligne pour ligne et
    // colonne pour colonne restent celles de la source, donc aucune carte de
    // source n'est nécessaire pour que les piles d'erreur du navigateur pointent juste.
    const stripped = stripTypeScriptTypes(data.toString('utf8'), { mode: 'strip' });
    return { mime, body: Buffer.from(stripped, 'utf8') };
  } catch (err: unknown) {
    const code = (err as { code?: string } | undefined)?.code ?? 'ERR_INCONNU';
    const message = err instanceof Error ? err.message : String(err);
    throw new TypeStripError(
      `retrait des types impossible pour « ${absPath} » [${code}] : ${message}`,
    );
  }
}

// Sert un fichier deja resolu en chemin absolu de confiance : les deux
// appelants (prefixe confine, liste blanche exacte) ont chacun leur propre
// facon de decider CE chemin ; celui-ci ne fait que repondre.
async function respondStaticFile(res: ServerResponse, absPath: string): Promise<void> {
  try {
    const { mime, body } = await readStaticFile(absPath);
    res.writeHead(200, { 'Content-Type': mime });
    res.end(body);
  } catch (err) {
    // Un défaut d'outillage se dit : il ne se déguise pas en 404.
    if (err instanceof TypeStripError) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(err.message);
      return;
    }
    res.writeHead(404);
    res.end('Not found');
  }
}

async function staticHandler(_req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  // No directory traversal: strip ".." segments before resolving.
  const safe = url.pathname.replace(/\.\.+/g, '');
  const p = path.join(PROJECT_ROOT, safe);
  const root = path.join(PROJECT_ROOT, 'src', 'web');
  if (!(p.startsWith(root + path.sep) || p === root)) {
    res.writeHead(404); res.end('Not found'); return;
  }
  await respondStaticFile(res, p);
}

// Trois primitives du moteur sont servies au navigateur (tool-subject,
// clock-time, usage) : la table ROUTES les nomme par CHEMIN EXACT, jamais par
// prefixe — un prefixe ouvrirait tout `src/engine/` au navigateur.
async function engineStaticHandler(_req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  await respondStaticFile(res, path.join(PROJECT_ROOT, url.pathname));
}

// Read once at boot, deliberately: the number must describe the code that IS
// running. A re-read at request time would report whatever sits on disk —
// after an `npm i -g`, that is the NEXT version, not this process. Proving
// what a daemon serves is a measured pain of this project; this is the answer.
const VERSION: string = PRODUCT_VERSION;

function versionHandler(_req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ version: VERSION }));
}

// What the page may load and run: its own files only, so text that slips into
// the HTML unescaped cannot execute. 'unsafe-inline' is for styles alone — the
// views set colours through `style="…"` attributes.
const PAGE_POLICY = [
  "default-src 'none'", "script-src 'self'", "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:", "connect-src 'self'",
  "frame-ancestors 'none'", "base-uri 'none'", "form-action 'none'",
].join('; ');

async function indexHandler(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const html = await fsp.readFile(HTML);
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': PAGE_POLICY,
      'X-Frame-Options': 'DENY',
    });
    res.end(html);
  } catch {
    res.writeHead(500);
    res.end('index.html missing');
  }
}

function streamHandler(req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });
  res.write(':ok\n\n');
  sseClients.add(res);
  // Replay current token snapshots so a fresh client sees state immediately.
  for (const [sid, rec] of sessionIndex) {
    const msg = tokensMessage(sid, rec as TokensCarrierLike);
    if (msg) {
      try { res.write(`data: ${JSON.stringify(msg)}\n\n`); } catch {}
    }
  }
  req.on('close', () => sseClients.delete(res));
}

async function eventsGetHandler(_req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
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

async function eventsClearHandler(_req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
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
      let files: string[];
      try { files = (await fsp.readdir(DIR)).filter(f => f.endsWith('.jsonl')); }
      catch { files = []; }
      for (const f of files) await deleteSession(path.join(DIR, f));
    }
    broadcastSessionsChanged();
  } catch {}
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('cleared');
}

async function summaryHandler(_req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
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

// One-shot token snapshot for a specific session. The SSE `tokens` stream only
// pushes the live/active session; a session picked from the overlay fetches
// this so the budget pill reflects it immediately. Returns JSON `null` when the
// session has no token state yet.
function tokensHandler(_req: IncomingMessage, res: ServerResponse, url: URL): void {
  const sid = url.searchParams.get('session');
  if (!sid) { res.writeHead(400); res.end('missing session'); return; }
  if (!validSessionId(sid)) { res.writeHead(400); res.end('invalid session id'); return; }
  const rec = sessionIndex.get(sid);
  const msg = rec ? tokensMessage(sid, rec as TokensCarrierLike) : null;
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(msg));
}

async function sessionsHandler(_req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  // Optional forced rescan — catch up with the disk. Useful if the user
  // deleted or added files outside the app.
  if (url.searchParams.has('rescan')) await rescanSessions();
  // Warm any not-yet-attempted prompt caches in parallel (fire-and-forget
  // after the response so the client gets a fast reply).
  const missing: string[] = [];
  for (const rec of sessionIndex.values()) {
    if (rec.promptCache === undefined) missing.push(rec.id);
  }
  // Check which sessions have a .summary.json (compacted).
  const summarySet = new Set<string>();
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
      agentSource: rec.agentSource,
    }))
    .sort((a, b) => b.mtime - a.mtime);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(sessions));
  // Background: resolve missing prompts, then broadcast a single refresh.
  if (missing.length) {
    (async () => {
      for (const id of missing) {
        await ensureFirstPrompt(path.join(DIR, id + '.jsonl'))
          .catch(err => console.error(`[routes] ensureFirstPrompt ${id.slice(0, 8)} failed: ${err.message}`));
      }
    })();
  }
}

// ─── Route table ──────────────────────────────────────────────────────────
const ROUTES: Route[] = [
  { method: 'POST', path: '/notify',     handler: notifyHandler, sameOrigin: true },
  { method: 'POST', path: '/shutdown',   handler: shutdownHandler, sameOrigin: true },
  { method: 'GET',  prefix: '/src/web/', handler: staticHandler },
  { method: 'GET',  path: '/src/engine/core/tool-subject.ts', handler: engineStaticHandler },
  { method: 'GET',  path: '/src/engine/core/clock-time.ts',   handler: engineStaticHandler },
  { method: 'GET',  path: '/src/engine/core/usage.ts',        handler: engineStaticHandler },
  { method: 'GET',  path: '/',           handler: indexHandler },
  { method: 'GET',  path: '/index.html', handler: indexHandler },
  { method: 'GET',  path: '/version',    handler: versionHandler },
  { method: 'GET',  path: '/stream',     handler: streamHandler },
  { method: 'GET',  path: '/events',     handler: eventsGetHandler },
  { method: 'POST', path: '/events',     handler: eventsClearHandler, sameOrigin: true },
  { method: 'GET',  path: '/summary',    handler: summaryHandler },
  { method: 'GET',  path: '/tokens',     handler: tokensHandler },
  { method: 'GET',  path: '/sessions',   handler: sessionsHandler },
  // Watchdog endpoints — same reasons as the observatory: the declaration
  // lives in its own module, the dispatch and the guards stay here. The
  // service is passed as a getter, not a value: this table is built when the
  // server module loads, and the watchdog only exists at the end of boot.
  ...createWatchdogRoutes(getWatchdogService),
  // Observatory endpoints — declared in their own module, spread here so the
  // dispatch, the 404/405 handling and the sameOrigin guard stay in one place.
  ...createObservatoryRoutes(getObservatoryService),
];

function pathMatches(route: Route, pathname: string): boolean {
  if (route.path !== undefined) return route.path === pathname;
  if (route.prefix !== undefined) return pathname.startsWith(route.prefix);
  return false;
}

// Find route, run guards, dispatch. 403 for a foreign Host, 404 for unknown
// path, 405 for known path without a matching method or with a failed
// sameOrigin guard.
async function dispatch(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!localHost(req)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('forbidden host');
    return;
  }
  // `req.url` est `string | undefined` dans le type Node — toujours défini en
  // pratique pour une vraie requête entrante (posé par le serveur HTTP avant
  // que `dispatch` ne soit appelé) ; le repli documente l'invariant sans
  // changer d'issue pour aucune requête réelle.
  const url = new URL(req.url ?? '', 'http://localhost');
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

export { dispatch, setServer, ROUTES, readStaticFile };

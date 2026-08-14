'use strict';
// HTTP surface of the observatory. Translation only — no domain logic lives
// here (CLAUDE.md § S): each handler reads the query, calls the service, and
// serialises the answer.
//
// The service arrives as a getter so requiring this module never opens the
// SQLite file: the other route tests must not touch the user's home.

import type { IncomingMessage, ServerResponse } from 'node:http';
// import type only: erased at emission, so this module still never actually
// requires service.ts (and therefore never opens the SQLite file) at runtime
// — only its shape is borrowed to type the injected getService/handlers.
import type { createObservatoryService } from './service.ts';

type Service = ReturnType<typeof createObservatoryService>;

const PRICE_SOURCE = 'netgain-table-embarquee';
const VALID_STATUSES = new Set(['new', 'accepted', 'ignored']);

function sendJson(res: ServerResponse, code: number, payload: unknown): void {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

// A missing engine is a 503 carrying the exact cause; anything else is a
// genuine 500. Either way the live canvas view keeps working.
function sendError(res: ServerResponse, err: unknown): void {
  if (err instanceof Error && 'engineMissing' in err && err.engineMissing) {
    sendJson(res, 503, {
      error: err.message,
      hint: 'Moteur d’analyse indisponible — le suivi temps réel reste actif.',
    });
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  console.error('[observatory] route failed:', message);
  sendJson(res, 500, { error: message });
}

// URL translation only — validation (the 7/30/90 table) lives in the service.
const daysOf = (url: URL): number | undefined => {
  const n = Number(url.searchParams.get('days'));
  return Number.isInteger(n) && n > 0 ? n : undefined;
};
const includeMachineOf = (url: URL): boolean => url.searchParams.get('includeMachine') === '1';

type RouteHandler = (req: IncomingMessage, res: ServerResponse, url: URL) => Promise<void>;
type BoundHandler = (req: IncomingMessage, res: ServerResponse, url: URL, service: Service) => Promise<void>;

interface Route {
  method: string;
  path?: string;
  prefix?: string;
  sameOrigin?: boolean;
  handler: RouteHandler;
}

function createObservatoryRoutes(getService: () => Service): Route[] {
  const bind = (handler: BoundHandler): RouteHandler => async (req, res, url) => {
    try {
      await handler(req, res, url, getService());
    } catch (err) {
      sendError(res, err);
    }
  };

  return [
    {
      method: 'GET', path: '/analysis/summary',
      handler: bind(async (_req, res, url, service) => {
        const summary = await service.summary({ days: daysOf(url), includeMachine: includeMachineOf(url) });
        sendJson(res, 200, { ...summary, priceSource: PRICE_SOURCE });
      }),
    },
    {
      method: 'GET', path: '/analysis/models',
      handler: bind(async (_req, res, url, service) => {
        const breakdown = await service.modelCosts({ days: daysOf(url), includeMachine: includeMachineOf(url) });
        sendJson(res, 200, { ...breakdown, priceSource: PRICE_SOURCE });
      }),
    },
    {
      method: 'GET', path: '/pricing',
      handler: bind(async (_req, res, _url, service) => {
        sendJson(res, 200, { ...(await service.pricing()), priceSource: PRICE_SOURCE });
      }),
    },
    {
      method: 'GET', path: '/analysis/sessions',
      handler: bind(async (_req, res, url, service) => {
        sendJson(res, 200, await service.sessions({
          project: url.searchParams.get('project') || undefined,
          days: daysOf(url),
          includeMachine: includeMachineOf(url),
        }));
      }),
    },
    {
      method: 'GET', prefix: '/analysis/session/',
      handler: bind(async (_req, res, url, service) => {
        const id = url.pathname.slice('/analysis/session/'.length);
        if (!id) { sendJson(res, 400, { error: 'identifiant de session manquant' }); return; }
        const session = await service.session(decodeURIComponent(id));
        if (!session) { sendJson(res, 404, { error: 'session inconnue' }); return; }
        sendJson(res, 200, { ...session, priceSource: PRICE_SOURCE });
      }),
    },
    {
      method: 'POST', path: '/analysis/scan', sameOrigin: true,
      // Answers 202 straight away; progress travels on the existing SSE stream.
      handler: bind(async (_req, res, url, service) => {
        const days = daysOf(url);
        service.scan(days === undefined ? {} : { days })
          .catch((err: unknown) => console.error('[observatory] scan failed:', err instanceof Error ? err.message : String(err)));
        sendJson(res, 202, { started: true });
      }),
    },
    {
      method: 'POST', path: '/analysis/purge', sameOrigin: true,
      // The wipe happens before answering (503 if the engine is missing —
      // never wipe what cannot be rebuilt); the rebuild scan then reports its
      // progress on the SSE stream, exactly like POST /analysis/scan.
      handler: bind(async (_req, res, url, service) => {
        const days = daysOf(url);
        await service.purge();
        service.scan(days === undefined ? {} : { days })
          .catch((err: unknown) => console.error('[observatory] scan failed:', err instanceof Error ? err.message : String(err)));
        sendJson(res, 202, { purged: true, started: true });
      }),
    },
    {
      method: 'GET', path: '/config/audit',
      handler: bind(async (_req, res, _url, service) => sendJson(res, 200, await service.configAudit())),
    },
    {
      method: 'GET', path: '/recommendations',
      handler: bind(async (_req, res, _url, service) => sendJson(res, 200, await service.recommendations())),
    },
    {
      method: 'POST', prefix: '/recommendations/', sameOrigin: true,
      handler: bind(async (_req, res, url, service) => {
        const id = Number(url.pathname.slice('/recommendations/'.length));
        const status = url.searchParams.get('status');
        if (!Number.isInteger(id) || status === null || !VALID_STATUSES.has(status)) {
          sendJson(res, 400, { error: 'identifiant ou statut invalide' });
          return;
        }
        if (!await service.setRecommendationStatus(id, status)) {
          sendJson(res, 404, { error: 'recommandation inconnue' });
          return;
        }
        sendJson(res, 200, { id, status });
      }),
    },
  ];
}

export { createObservatoryRoutes, PRICE_SOURCE };

'use strict';
// Who may call the server — the two checks `dispatch` runs before any handler.
// Both read request headers only, and both let through a caller that sends
// none: only a browser can be steered by a third-party site, and it always does.

import type { IncomingMessage } from 'node:http';

const PORT = process.env.PORT || 3333;

// Reject cross-origin POSTs to destructive endpoints. CLI/programmatic callers
// (lifecycle.ts, curl) have no Origin header and are allowed; browsers always
// send Origin on cross-origin requests, so a malicious site can't hit /shutdown
// or /events?clear from a tab in another origin.
function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  return origin === `http://localhost:${PORT}` || origin === `http://127.0.0.1:${PORT}`;
}

// A site that points its own domain at 127.0.0.1 gets same-origin reads from
// the browser, but the Host header then carries that domain, not ours.
const LOCAL_HOST = /^(localhost|127\.0\.0\.1)(:\d+)?$/i;
function localHost(req: IncomingMessage): boolean {
  const host = req.headers.host;
  if (!host) return true;
  return LOCAL_HOST.test(host);
}

export { sameOrigin, localHost };

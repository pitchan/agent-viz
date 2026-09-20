// GET /tokens?session=<id> — lets the client fetch a specific session's token
// snapshot on demand. SSE only pushes `tokens` for the live/active session, so
// a session picked from the overlay needs this one-shot endpoint to populate
// the budget pill.

import { expect, test } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dispatch } from '../../src/server/routes.ts';
import { sessionIndex } from '../../src/server/session-index.ts';
import type { SessionRecord } from '../../src/server/session-index.ts';
import { ensureTokens } from '../../src/server/tokens.ts';

// Minimal http.ServerResponse stand-in — captures status + body.
function mockRes() {
  return {
    statusCode: null as number | null, headers: null as Record<string, string> | null, body: '',
    writeHead(code: number, headers?: Record<string, string>) { this.statusCode = code; this.headers = headers || null; },
    end(data?: string) { this.body = data || ''; },
  };
}

const dispatchTo = (req: unknown, res: unknown) =>
  dispatch(req as unknown as IncomingMessage, res as unknown as ServerResponse);

const get = (path: string) => dispatchTo({ url: path, method: 'GET', headers: {} }, mockRes());

test('GET /tokens returns the token snapshot for a known session', async () => {
  const id = 'tokens-route-sess-1';
  const rec: { id: string; tokens: any } = { id, tokens: null };
  ensureTokens(rec);
  rec.tokens.main.in = 4321;
  rec.tokens.main.lastModel = 'claude-opus-4-7';
  sessionIndex.set(id, rec as unknown as SessionRecord);
  try {
    const res = mockRes();
    await dispatchTo({ url: `/tokens?session=${id}`, method: 'GET', headers: {} }, res);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.type).toBe('tokens');
    expect(body.session).toBe(id);
    expect(body.main.in).toBe(4321);
    expect(body.tokensSupported).toBe(true);
  } finally {
    sessionIndex.delete(id);
  }
});

test('GET /tokens returns null for an unknown session', async () => {
  const res = mockRes();
  await dispatchTo({ url: '/tokens?session=tokens-route-absent', method: 'GET', headers: {} }, res);
  expect(res.statusCode).toBe(200);
  expect(JSON.parse(res.body)).toBe(null);
});

test('GET /tokens rejects an invalid session id', async () => {
  const res = mockRes();
  await dispatchTo({ url: '/tokens?session=../etc/passwd', method: 'GET', headers: {} }, res);
  expect(res.statusCode).toBe(400);
});

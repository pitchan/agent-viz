'use strict';
// GET /tokens?session=<id> — lets the client fetch a specific session's token
// snapshot on demand. SSE only pushes `tokens` for the live/active session, so
// a session picked from the overlay needs this one-shot endpoint to populate
// the budget pill.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { dispatch } = require('../../lib/server/routes');
const { sessionIndex } = require('../../lib/server/session-index');
const { ensureTokens } = require('../../lib/server/tokens');

// Minimal http.ServerResponse stand-in — captures status + body.
function mockRes() {
  return {
    statusCode: null, headers: null, body: '',
    writeHead(code, headers) { this.statusCode = code; this.headers = headers || null; },
    end(data) { this.body = data || ''; },
  };
}

const get = (path) => dispatch({ url: path, method: 'GET', headers: {} }, mockRes());

test('GET /tokens returns the token snapshot for a known session', async () => {
  const id = 'tokens-route-sess-1';
  const rec = { id, tokens: null };
  ensureTokens(rec);
  rec.tokens.main.in = 4321;
  rec.tokens.main.lastModel = 'claude-opus-4-7';
  sessionIndex.set(id, rec);
  try {
    const res = mockRes();
    await dispatch({ url: `/tokens?session=${id}`, method: 'GET', headers: {} }, res);
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.type, 'tokens');
    assert.equal(body.session, id);
    assert.equal(body.main.in, 4321);
    assert.equal(body.tokensSupported, true);
  } finally {
    sessionIndex.delete(id);
  }
});

test('GET /tokens returns null for an unknown session', async () => {
  const res = mockRes();
  await dispatch({ url: '/tokens?session=tokens-route-absent', method: 'GET', headers: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body), null);
});

test('GET /tokens rejects an invalid session id', async () => {
  const res = mockRes();
  await dispatch({ url: '/tokens?session=../etc/passwd', method: 'GET', headers: {} }, res);
  assert.equal(res.statusCode, 400);
});

// Unit tests for public/viz-narrator.js. Pure logic — no DOM, no fake timers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commonPathPrefix } from '../../public/viz-narrator.js';

test('commonPathPrefix: 3 paths under same dir → "<dir>/"', () => {
  assert.equal(
    commonPathPrefix(['auth/login.js', 'auth/middleware.js', 'auth/utils/jwt.js']),
    'auth/'
  );
});

test('commonPathPrefix: deeper common prefix → deepest shared dir', () => {
  assert.equal(
    commonPathPrefix(['a/b/c.js', 'a/b/d.js', 'a/x/y.js']),
    'a/'
  );
});

test('commonPathPrefix: paths with no shared dir → null', () => {
  assert.equal(commonPathPrefix(['a.js', 'b.js']), null);
});

test('commonPathPrefix: less than 2 paths → null', () => {
  assert.equal(commonPathPrefix(['a/b/c.js']), null);
  assert.equal(commonPathPrefix([]), null);
});

test('commonPathPrefix: identical paths → their dir', () => {
  assert.equal(
    commonPathPrefix(['auth/login.js', 'auth/login.js']),
    'auth/'
  );
});

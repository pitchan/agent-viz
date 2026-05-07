// Unit tests for public/viz-narrator.js. Pure logic — no DOM, no fake timers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  commonPathPrefix, composeNarrator,
  markNarratorDirty, setRenderFn,
} from '../../public/viz-narrator.js';

function freshState() {
  return {
    nodes: new Map(),
    timelineEntries: [],
    toolsCompleted: 0,
  };
}
function freshVis() {
  return { runningNodes: new Set() };
}

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

test('composeNarrator: empty state → null', () => {
  assert.equal(composeNarrator(freshState(), freshVis(), Date.now()), null);
});

test('composeNarrator: session present but 0 events → null', () => {
  const state = freshState();
  state.nodes.set('s:abc', {
    id: 's:abc', type: 'session', status: 'running',
    parentId: null, children: [], startTime: '2026-05-07T10:00:00Z',
  });
  assert.equal(composeNarrator(state, freshVis(), Date.now()), null);
});

function withSessionAndTool(state, opts) {
  const sid = 's:abc';
  const session = state.nodes.get(sid) || {
    id: sid, type: 'session', status: 'running',
    parentId: null, children: [], startTime: '2026-05-07T10:00:00Z',
  };
  state.nodes.set(sid, session);
  state.timelineEntries.push({
    ts: '2026-05-07T10:00:00Z', nodeId: sid, type: 'session', label: 'Session', sub: '',
  });
  for (const t of opts.tools || []) {
    const id = `t:${t.id}`;
    const node = {
      id, type: 'tool', label: t.label || 'Tool', sub: t.sub || '',
      status: t.status || 'running',
      parentId: t.parentId || sid,
      children: [],
      startTime: t.startTime || '2026-05-07T10:00:01Z',
      endTime: t.endTime || null,
    };
    state.nodes.set(id, node);
    session.children.push(node);
    state.timelineEntries.push({
      ts: node.startTime, nodeId: id, type: 'tool', label: node.label, sub: node.sub,
    });
  }
}

test('composeNarrator: single Read running on main thread → "Read" tone active', () => {
  const state = freshState();
  withSessionAndTool(state, {
    tools: [{ id: '1', label: 'Read', sub: 'auth/login.js', status: 'running' }],
  });
  const vis = freshVis();
  vis.runningNodes.add('t:1');
  const result = composeNarrator(state, vis, Date.now());
  assert.deepEqual(result, { text: 'Read', tone: 'active' });
});

test('composeNarrator: 3 Reads + 1 Edit running → "3 reads +1" tone active', () => {
  const state = freshState();
  withSessionAndTool(state, {
    tools: [
      { id: '1', label: 'Read', sub: 'auth/a.js', status: 'running' },
      { id: '2', label: 'Read', sub: 'auth/b.js', status: 'running' },
      { id: '3', label: 'Read', sub: 'auth/c.js', status: 'running' },
      { id: '4', label: 'Edit', sub: 'auth/d.js', status: 'running' },
    ],
  });
  const vis = freshVis();
  vis.runningNodes.add('t:1');
  vis.runningNodes.add('t:2');
  vis.runningNodes.add('t:3');
  vis.runningNodes.add('t:4');
  const result = composeNarrator(state, vis, Date.now());
  assert.equal(result.tone, 'active');
  assert.ok(result.text.startsWith('3 reads +1'),
    `expected primary "3 reads +1", got "${result.text}"`);
});

test('composeNarrator: 3 Reads same dir → "3 reads · auth/" tone active', () => {
  const state = freshState();
  withSessionAndTool(state, {
    tools: [
      { id: '1', label: 'Read', sub: 'auth/login.js', status: 'running' },
      { id: '2', label: 'Read', sub: 'auth/middleware.js', status: 'running' },
      { id: '3', label: 'Read', sub: 'auth/utils/jwt.js', status: 'running' },
    ],
  });
  const vis = freshVis();
  vis.runningNodes.add('t:1');
  vis.runningNodes.add('t:2');
  vis.runningNodes.add('t:3');
  const result = composeNarrator(state, vis, Date.now());
  assert.deepEqual(result, { text: '3 reads · auth/', tone: 'active' });
});

test('composeNarrator: tool running under sub-agent → primary = sub-agent label', () => {
  const state = freshState();
  const sid = 's:abc';
  const session = {
    id: sid, type: 'session', status: 'running',
    parentId: null, children: [], startTime: '2026-05-07T10:00:00Z',
  };
  state.nodes.set(sid, session);
  const aid = 'a:cr';
  const agent = {
    id: aid, type: 'agent', label: 'code-reviewer', sub: '',
    status: 'running', parentId: sid, children: [],
    startTime: '2026-05-07T10:00:01Z',
  };
  state.nodes.set(aid, agent);
  session.children.push(agent);
  const tid = 't:1';
  const tool = {
    id: tid, type: 'tool', label: 'Read', sub: 'src/a.js',
    status: 'running', parentId: aid, children: [],
    startTime: '2026-05-07T10:00:02Z',
  };
  state.nodes.set(tid, tool);
  agent.children.push(tool);
  state.timelineEntries.push(
    { ts: '2026-05-07T10:00:00Z', nodeId: sid, type: 'session', label: 'Session', sub: '' },
    { ts: '2026-05-07T10:00:01Z', nodeId: aid, type: 'agent', label: 'code-reviewer', sub: '' },
    { ts: '2026-05-07T10:00:02Z', nodeId: tid, type: 'tool', label: 'Read', sub: 'src/a.js' },
  );
  const vis = freshVis();
  vis.runningNodes.add(tid);
  const result = composeNarrator(state, vis, Date.now());
  assert.equal(result.tone, 'active');
  assert.ok(result.text.startsWith('code-reviewer'),
    `expected primary to start with "code-reviewer", got "${result.text}"`);
});

test('composeNarrator: idle 30s + error 14s ago → "idle 14s · err 14s" tone error', () => {
  const state = freshState();
  const sid = 's:abc';
  const session = {
    id: sid, type: 'session', status: 'running',
    parentId: null, children: [], startTime: '2026-05-07T10:00:00Z',
  };
  state.nodes.set(sid, session);
  const now = Date.parse('2026-05-07T10:00:30.000Z');
  const errEndIso = new Date(now - 14_000).toISOString();
  const tool = {
    id: 't:err', type: 'tool', label: 'Edit', sub: 'auth/x.js',
    status: 'error', parentId: sid, children: [],
    startTime: '2026-05-07T10:00:10Z', endTime: errEndIso,
  };
  state.nodes.set('t:err', tool);
  session.children.push(tool);
  state.timelineEntries.push(
    { ts: '2026-05-07T10:00:00Z', nodeId: sid, type: 'session', label: 'Session', sub: '' },
    { ts: '2026-05-07T10:00:10Z', nodeId: 't:err', type: 'tool', label: 'Edit', sub: 'auth/x.js' },
  );
  const vis = freshVis();
  const result = composeNarrator(state, vis, now);
  assert.equal(result.tone, 'error');
  assert.match(result.text, /^idle 14s · err 14s$/);
});

test('composeNarrator: session done → "session done · N tools · Xm" tone done', () => {
  const state = freshState();
  state.toolsCompleted = 42;
  state.nodes.set('s:abc', {
    id: 's:abc', type: 'session', status: 'done',
    parentId: null, children: [],
    startTime: '2026-05-07T10:00:00.000Z',
    endTime:   '2026-05-07T10:03:12.000Z',
  });
  state.timelineEntries.push({
    ts: '2026-05-07T10:00:00.000Z', nodeId: 's:abc',
    type: 'session', label: 'Session', sub: '',
  });
  const result = composeNarrator(state, freshVis(), Date.now());
  assert.deepEqual(result, { text: 'session done · 42 tools · 3.2m', tone: 'done' });
});

test('driver: markNarratorDirty calls renderFn once per microtask burst', async () => {
  let calls = 0;
  setRenderFn(() => { calls++; });
  markNarratorDirty();
  markNarratorDirty();
  markNarratorDirty();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(calls, 1, 'expected coalesced single call');
  markNarratorDirty();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(calls, 2);
  setRenderFn(null);
});

test('driver: setRenderFn(null) silences the driver', async () => {
  setRenderFn(null);
  markNarratorDirty(); // must not throw
  await Promise.resolve();
});

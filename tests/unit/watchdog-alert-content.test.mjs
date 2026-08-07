// Unit tests for what a watchdog alert actually says.
//
// "Bash called 4× with the same input in 60s" is not actionable: it names
// neither the command that is looping, nor when it looped, nor which agent is
// doing it. An alert you have to go investigate is only half an alert. These
// tests pin the payload the panel needs to be able to show all three.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWatchdog } from '../../public/viz-watchdog.mjs';

const T = 1_700_000_000_000;
const iso = ms => new Date(ms).toISOString();
const clockAt = (start = T) => ({ now: () => start });

function pre({ at, session = 'sid1', tool = 'Bash', input = { command: 'npm test' }, id = 't1', agentId, agentType }) {
  const evt = {
    session_id: session, hook_event_name: 'PreToolUse',
    tool_name: tool, tool_input: input, tool_use_id: id, _ts: iso(at),
  };
  if (agentId) evt.agent_id = agentId;
  if (agentType) evt.agent_type = agentType;
  return evt;
}
function post({ at, session = 'sid1', tool = 'Bash', id = 't1' }) {
  return { session_id: session, hook_event_name: 'PostToolUse', tool_name: tool, tool_use_id: id, _ts: iso(at) };
}

// ─── Loop: which command, and when ─────────────────────────────────────────

test('loop alert carries the exact command, not a truncated label', () => {
  const wd = createWatchdog({ now: clockAt().now });
  const command = 'rg --hidden --no-ignore "session_id" lib/server/observatory --stats';
  let last = [];
  for (let i = 0; i < 4; i++) {
    last = wd.processEvent(pre({ at: T - 15_000 + i * 5_000, id: `t${i}`, input: { command } })).newAlerts;
  }
  assert.equal(last[0].subject, command);
});

test('loop alert carries one real timestamp per repeat', () => {
  const wd = createWatchdog({ now: clockAt().now });
  const times = [T - 15_000, T - 10_000, T - 5_000, T];
  let last = [];
  times.forEach((at, i) => { last = wd.processEvent(pre({ at, id: `t${i}` })).newAlerts; });
  assert.deepEqual(
    last[0].occurrences,
    times.map((ts, i) => ({ ts, toolUseId: `t${i}`, failed: null })),
    'the panel must be able to print the four real clock times',
  );
});

test('loop alert names the agent that ran the calls', () => {
  const wd = createWatchdog({ now: clockAt().now });
  let last = [];
  for (let i = 0; i < 4; i++) {
    last = wd.processEvent(pre({
      at: T - 15_000 + i * 5_000, id: `t${i}`,
      agentId: 'ag-7f3c1b90', agentType: 'Explore',
    })).newAlerts;
  }
  assert.equal(last[0].agentId, 'ag-7f3c1b90');
  assert.equal(last[0].agentType, 'Explore');
});

test('loop alert on the main thread leaves the agent fields empty', () => {
  const wd = createWatchdog({ now: clockAt().now });
  let last = [];
  for (let i = 0; i < 4; i++) last = wd.processEvent(pre({ at: T - 15_000 + i * 5_000, id: `t${i}` })).newAlerts;
  assert.equal(last[0].agentId, '');
  assert.equal(last[0].agentType, '');
});

test('two agents running the same command are not merged into one loop', () => {
  const wd = createWatchdog({ now: clockAt().now });
  // Two subagents, two identical calls each. Nobody looped: 2 < 4.
  for (let i = 0; i < 2; i++) {
    wd.processEvent(pre({ at: T - 10_000 + i * 1_000, id: `a${i}`, agentId: 'ag-a', agentType: 'Explore' }));
    wd.processEvent(pre({ at: T - 10_000 + i * 1_000, id: `b${i}`, agentId: 'ag-b', agentType: 'Plan' }));
  }
  assert.deepEqual(wd.getActiveAlerts(), [], 'four calls across two agents is not a loop');
});

test('each looping agent gets its own alert', () => {
  const wd = createWatchdog({ now: clockAt().now });
  for (let i = 0; i < 4; i++) {
    wd.processEvent(pre({ at: T - 15_000 + i * 3_000, id: `a${i}`, agentId: 'ag-a', agentType: 'Explore' }));
    wd.processEvent(pre({ at: T - 15_000 + i * 3_000, id: `b${i}`, agentId: 'ag-b', agentType: 'Plan' }));
  }
  const active = wd.getActiveAlerts();
  assert.equal(active.length, 2);
  assert.deepEqual(active.map(a => a.agentType).sort(), ['Explore', 'Plan']);
});

// ─── Stuck: what is in flight, and since when ──────────────────────────────

test('stuck alert lists each in-flight tool with its subject and start time', () => {
  const wd = createWatchdog({ now: clockAt().now });
  wd.processEvent(pre({ at: T - 5 * 60_000, id: 'tA', tool: 'Bash', input: { command: 'npm run build' } }));
  wd.processEvent(pre({ at: T - 4 * 60_000, id: 'tB', tool: 'Read', input: { file_path: '/repo/lib/hook.js' } }));
  const alert = wd.tick().newAlerts[0];
  assert.deepEqual(alert.tools, [
    { toolUseId: 'tA', toolName: 'Bash', subject: 'npm run build', startedAt: T - 5 * 60_000, agentId: '', agentType: '' },
    { toolUseId: 'tB', toolName: 'Read', subject: 'hook.js',       startedAt: T - 4 * 60_000, agentId: '', agentType: '' },
  ]);
});

test('a tool that completed is gone from the stuck list', () => {
  const wd = createWatchdog({ now: clockAt().now });
  wd.processEvent(pre({ at: T - 5 * 60_000, id: 'tA', tool: 'Bash', input: { command: 'npm run build' } }));
  wd.processEvent(pre({ at: T - 5 * 60_000, id: 'tB', tool: 'Grep', input: { pattern: 'agent_id' } }));
  wd.processEvent(post({ at: T - 4 * 60_000, id: 'tA', tool: 'Bash' }));
  const alert = wd.tick().newAlerts[0];
  assert.equal(alert.tools.length, 1);
  assert.equal(alert.tools[0].toolUseId, 'tB');
  assert.equal(alert.tools[0].subject, 'agent_id');
});

test('stuck alert names the agent holding the in-flight tool', () => {
  const wd = createWatchdog({ now: clockAt().now });
  wd.processEvent(pre({
    at: T - 5 * 60_000, id: 'tA', tool: 'Bash', input: { command: 'pytest -x' },
    agentId: 'ag-9c2', agentType: 'general-purpose',
  }));
  const alert = wd.tick().newAlerts[0];
  assert.equal(alert.tools[0].agentId, 'ag-9c2');
  assert.equal(alert.tools[0].agentType, 'general-purpose');
});

// ─── Retry storm ───────────────────────────────────────────────────────────

test('retryStorm alert carries the subject of the failing call', () => {
  const wd = createWatchdog({ now: clockAt().now });
  let last = [];
  for (let i = 0; i < 3; i++) {
    last = wd.processEvent({
      session_id: 'sid1', hook_event_name: 'PostToolUseFailure',
      tool_name: 'Bash', tool_input: { command: 'npm ci' }, tool_use_id: `f${i}`,
      _ts: iso(T - 3_000 + i * 1_000),
    }).newAlerts;
  }
  assert.equal(last[0].subject, 'npm ci');
});

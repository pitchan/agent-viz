'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { pickTargetDefault } = require('../../lib/prompt-install');

test('pickTargetDefault: both detected → index 2 (Both)', () => {
  assert.equal(pickTargetDefault({ claude: true, copilot: true }), 2);
});

test('pickTargetDefault: only claude detected → index 0', () => {
  assert.equal(pickTargetDefault({ claude: true, copilot: false }), 0);
});

test('pickTargetDefault: only copilot detected → index 1', () => {
  assert.equal(pickTargetDefault({ claude: false, copilot: true }), 1);
});

test('pickTargetDefault: nothing detected → index 2 (Both, lets user pre-install)', () => {
  assert.equal(pickTargetDefault({ claude: false, copilot: false }), 2);
});

const { PassThrough } = require('node:stream');
const { promptInstallParams } = require('../../lib/prompt-install');

function makeMockIO() {
  const input = new PassThrough();
  const output = new PassThrough();
  let captured = '';
  output.on('data', (chunk) => { captured += chunk.toString(); });
  return {
    input,
    output,
    get captured() { return captured; },
  };
}

function press(input, name, modifiers = {}) {
  // emit a synthetic keypress — bypasses readline parser, delivers directly
  input.emit('keypress', '', { name, ...modifiers });
}

async function tick() { return new Promise((r) => setImmediate(r)); }

test('promptInstallParams: target=both default, no project → returns user scope without prompt', async () => {
  const io = makeMockIO();
  const promise = promptInstallParams({
    detected: { claude: true, copilot: true },
    projectRoot: null,
    io: { input: io.input, output: io.output },
  });
  await tick();
  press(io.input, 'return');                 // accept "Both"
  const result = await promise;
  assert.deepEqual(result, { target: 'both', scope: 'user' });
  assert.match(io.captured, /Which agent\(s\) to instrument\?/);
  assert.match(io.captured, /no project detected/i);
});

test('promptInstallParams: arrow down navigates to "both" (already last index stays put)', async () => {
  const io = makeMockIO();
  const promise = promptInstallParams({
    detected: { claude: true, copilot: false },     // default index 0 = claude
    projectRoot: null,
    io: { input: io.input, output: io.output },
  });
  await tick();
  press(io.input, 'down'); await tick();              // claude → copilot
  press(io.input, 'down'); await tick();              // copilot → both
  press(io.input, 'down'); await tick();              // both (last) → no-op
  press(io.input, 'return');
  const result = await promise;
  assert.equal(result.target, 'both');
});

test('promptInstallParams: Ctrl+C rejects with aborted', async () => {
  const io = makeMockIO();
  const promise = promptInstallParams({
    detected: { claude: true, copilot: true },
    projectRoot: null,
    io: { input: io.input, output: io.output },
  });
  await tick();
  press(io.input, 'c', { ctrl: true });
  await assert.rejects(promise, /aborted/);
});

test('promptInstallParams: detection labels rendered correctly', async () => {
  const io = makeMockIO();
  const promise = promptInstallParams({
    detected: { claude: true, copilot: false },
    projectRoot: null,
    io: { input: io.input, output: io.output },
  });
  await tick();
  press(io.input, 'return');
  await promise;
  assert.match(io.captured, /Claude Code \(detected\)/);
  assert.match(io.captured, /Copilot CLI \(not detected\)/);
});

test('promptInstallParams: with projectRoot, scope prompt asked, default user', async () => {
  const io = makeMockIO();
  const promise = promptInstallParams({
    detected: { claude: true, copilot: true },
    projectRoot: '/some/project',
    io: { input: io.input, output: io.output },
  });
  await tick();
  press(io.input, 'return'); await tick();    // accept Both
  press(io.input, 'return');                   // accept user (default)
  const result = await promise;
  assert.deepEqual(result, { target: 'both', scope: 'user' });
  assert.match(io.captured, /Where to install hooks\?/);
});

test('promptInstallParams: scope down twice + enter → local', async () => {
  const io = makeMockIO();
  const promise = promptInstallParams({
    detected: { claude: true, copilot: true },
    projectRoot: '/some/project',
    io: { input: io.input, output: io.output },
  });
  await tick();
  press(io.input, 'return'); await tick();    // accept Both
  press(io.input, 'down'); await tick();       // user → project
  press(io.input, 'down'); await tick();       // project → local
  press(io.input, 'return');
  const result = await promise;
  assert.equal(result.scope, 'local');
});

// Regression: on Windows real TTY, raw mode was being toggled between the
// two ask() calls (off → on → off → on). The off→on transition caused the
// OS to re-deliver a phantom \r in a later macrotask, which auto-resolved
// the scope prompt to its default ('user') without user input.
// The fix is to enable raw mode ONCE for the whole dialog and disable it
// ONCE at the end. Verifies the call shape rather than simulating the
// platform-specific phantom event, which can't be reproduced with a
// PassThrough stream.
test('promptInstallParams: raw mode is toggled exactly once per dialog (not per ask)', async () => {
  const calls = [];
  const io = makeMockIO();
  // Decorate the mock input with TTY-style methods so the session helper
  // exercises the real raw-mode code path.
  io.input.isTTY = true;
  io.input.isRaw = false;
  io.input.setRawMode = function (v) { calls.push(['setRawMode', v]); this.isRaw = v; return this; };
  io.input.unref = function () { calls.push(['unref']); return this; };

  const promise = promptInstallParams({
    detected: { claude: true, copilot: true },
    projectRoot: '/some/project',
    io: { input: io.input, output: io.output },
  });
  await tick();
  press(io.input, 'return'); await tick();    // accept Both
  press(io.input, 'return');                   // accept user
  await promise;

  const rawCalls = calls.filter((c) => c[0] === 'setRawMode');
  assert.deepEqual(
    rawCalls,
    [['setRawMode', true], ['setRawMode', false]],
    'raw mode must be enabled ONCE and disabled ONCE — not toggled between asks'
  );
});

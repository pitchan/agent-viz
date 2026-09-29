import { expect, test } from 'vitest';
import { PassThrough } from 'node:stream';
import { pickTargetDefault, promptInstallParams } from '../../src/server/prompt-install.ts';

test('pickTargetDefault: both detected → index 3 (All agents)', () => {
  expect(pickTargetDefault({ claude: true, copilot: true, antigravity: false })).toBe(3);
});

test('pickTargetDefault: only claude detected → index 0', () => {
  expect(pickTargetDefault({ claude: true, copilot: false, antigravity: false })).toBe(0);
});

test('pickTargetDefault: only copilot detected → index 1', () => {
  expect(pickTargetDefault({ claude: false, copilot: true, antigravity: false })).toBe(1);
});

test('pickTargetDefault: only antigravity detected → index 2', () => {
  expect(pickTargetDefault({ claude: false, copilot: false, antigravity: true })).toBe(2);
});

test('pickTargetDefault: nothing detected → index 3 (All agents, lets user pre-install)', () => {
  expect(pickTargetDefault({ claude: false, copilot: false, antigravity: false })).toBe(3);
});

type MockInput = PassThrough & {
  isTTY?: boolean;
  isRaw?: boolean;
  setRawMode?: (mode: boolean) => unknown;
  unref?: () => unknown;
};

function makeMockIO() {
  const input = new PassThrough() as MockInput;
  const output = new PassThrough();
  let captured = '';
  output.on('data', (chunk) => { captured += chunk.toString(); });
  return {
    input,
    output,
    get captured() { return captured; },
  };
}

function press(input: MockInput, name: string, modifiers: Record<string, unknown> = {}) {
  // emit a synthetic keypress — bypasses readline parser, delivers directly
  input.emit('keypress', '', { name, ...modifiers });
}

async function tick() { return new Promise((r) => setImmediate(r)); }

test('promptInstallParams: target=both default, no project → returns user scope without prompt', async () => {
  const io = makeMockIO();
  const promise = promptInstallParams({
    detected: { claude: true, copilot: true, antigravity: false },
    projectRoot: null,
    io: { input: io.input, output: io.output },
  });
  await tick();
  press(io.input, 'return');                 // accept "All agents"
  const result = await promise;
  expect(result).toEqual({ target: 'both', scope: 'user' });
  expect(io.captured).toMatch(/Which agent\(s\) to instrument\?/);
  expect(io.captured).toMatch(/no project detected/i);
});

test('promptInstallParams: arrow down navigates to "both" (already last index stays put)', async () => {
  const io = makeMockIO();
  const promise = promptInstallParams({
    detected: { claude: true, copilot: false, antigravity: false },     // default index 0 = claude
    projectRoot: null,
    io: { input: io.input, output: io.output },
  });
  await tick();
  press(io.input, 'down'); await tick();              // claude → copilot
  press(io.input, 'down'); await tick();              // copilot → antigravity
  press(io.input, 'down'); await tick();              // antigravity → both
  press(io.input, 'down'); await tick();              // both (last) → no-op
  press(io.input, 'return');
  const result = await promise;
  expect(result.target).toBe('both');
});

test('promptInstallParams: Ctrl+C rejects with aborted', async () => {
  const io = makeMockIO();
  const promise = promptInstallParams({
    detected: { claude: true, copilot: true, antigravity: false },
    projectRoot: null,
    io: { input: io.input, output: io.output },
  });
  await tick();
  press(io.input, 'c', { ctrl: true });
  await expect(promise).rejects.toThrow(/aborted/);
});

test('promptInstallParams: detection labels rendered correctly', async () => {
  const io = makeMockIO();
  const promise = promptInstallParams({
    detected: { claude: true, copilot: false, antigravity: false },
    projectRoot: null,
    io: { input: io.input, output: io.output },
  });
  await tick();
  press(io.input, 'return');
  await promise;
  expect(io.captured).toMatch(/Claude Code \(detected\)/);
  expect(io.captured).toMatch(/Copilot CLI \(not detected\)/);
  expect(io.captured).toMatch(/Antigravity CLI \(not detected\)/);
  expect(io.captured).toMatch(/All agents/);
});

test('promptInstallParams: with projectRoot, scope prompt asked, default user', async () => {
  const io = makeMockIO();
  const promise = promptInstallParams({
    detected: { claude: true, copilot: true, antigravity: false },
    projectRoot: '/some/project',
    io: { input: io.input, output: io.output },
  });
  await tick();
  press(io.input, 'return'); await tick();    // accept All agents
  press(io.input, 'return');                   // accept user (default)
  const result = await promise;
  expect(result).toEqual({ target: 'both', scope: 'user' });
  expect(io.captured).toMatch(/Where to install hooks\?/);
});

// 'both' couvre aussi Antigravity, qui n'a pas de portée locale : ce test choisit
// donc un agent seul (Claude) plutôt que 'both', pour garder 'local' atteignable.
test('promptInstallParams: scope down twice + enter → local (single agent that supports it)', async () => {
  const io = makeMockIO();
  const promise = promptInstallParams({
    detected: { claude: true, copilot: false, antigravity: false },
    projectRoot: '/some/project',
    io: { input: io.input, output: io.output },
  });
  await tick();
  press(io.input, 'return'); await tick();    // accept Claude Code (default, single detected)
  press(io.input, 'down'); await tick();       // user → project
  press(io.input, 'down'); await tick();       // project → local
  press(io.input, 'return');
  const result = await promise;
  expect(result.scope).toBe('local');
});

test('promptInstallParams: target antigravity → scope options omit local', async () => {
  const io = makeMockIO();
  const promise = promptInstallParams({
    detected: { claude: false, copilot: false, antigravity: true },
    projectRoot: '/some/project',
    io: { input: io.input, output: io.output },
  });
  await tick();
  press(io.input, 'return'); await tick();    // accept Antigravity CLI (default, single detected)
  press(io.input, 'down'); await tick();       // user → project
  press(io.input, 'down'); await tick();       // project (last: local is excluded) → no-op
  press(io.input, 'return');
  const result = await promise;
  expect(result).toEqual({ target: 'antigravity', scope: 'project' });
  expect(io.captured).not.toMatch(/local — this repo only/);
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
  const calls: unknown[][] = [];
  const io = makeMockIO();
  // Decorate the mock input with TTY-style methods so the session helper
  // exercises the real raw-mode code path.
  io.input.isTTY = true;
  io.input.isRaw = false;
  io.input.setRawMode = function (this: MockInput, v: boolean) { calls.push(['setRawMode', v]); this.isRaw = v; return this; };
  io.input.unref = function (this: MockInput) { calls.push(['unref']); return this; };

  const promise = promptInstallParams({
    detected: { claude: true, copilot: true, antigravity: false },
    projectRoot: '/some/project',
    io: { input: io.input, output: io.output },
  });
  await tick();
  press(io.input, 'return'); await tick();    // accept All agents
  press(io.input, 'return');                   // accept user
  await promise;

  const rawCalls = calls.filter((c) => c[0] === 'setRawMode');
  expect(rawCalls, 'raw mode must be enabled ONCE and disabled ONCE — not toggled between asks').toEqual([['setRawMode', true], ['setRawMode', false]]);
});

'use strict';
// Interactive dialog for `agent-viz install-hooks` (zero flags + TTY).
// Pure dialog: takes detection + projectRoot + io streams, returns
// { target, scope }. No filesystem I/O, no install logic.

const readline = require('node:readline');

const TARGET_OPTIONS = [
  { value: 'claude',  label: 'Claude Code' },
  { value: 'copilot', label: 'Copilot CLI' },
  { value: 'both',    label: 'Both' },
];

const SCOPE_OPTIONS = [
  { value: 'user',    label: 'user — works in every project' },
  { value: 'project', label: 'project — committed to this repo, shared with team' },
  { value: 'local',   label: 'local — this repo only, gitignored' },
];

function pickTargetDefault(detected) {
  if (detected.claude && detected.copilot) return 2;
  if (detected.claude) return 0;
  if (detected.copilot) return 1;
  return 2;
}

// Render a single-question selector. Returns the selected option's value.
// Throws Error('aborted') on Ctrl+C.
function ask({ question, options, initial, io }) {
  return new Promise((resolve, reject) => {
    const { input, output } = io;
    let idx = initial;
    let renderedLines = 0;

    const wasRaw = input.isTTY ? input.isRaw : null;
    if (input.isTTY && typeof input.setRawMode === 'function') input.setRawMode(true);
    readline.emitKeypressEvents(input);

    const clear = () => {
      for (let i = 0; i < renderedLines; i++) {
        output.write('\x1b[1A\x1b[2K'); // cursor up + erase line
      }
      renderedLines = 0;
    };

    const render = () => {
      clear();
      output.write(question + '\n');
      let lines = 1;
      for (let i = 0; i < options.length; i++) {
        const cursor = i === idx ? '> ' : '  ';
        output.write(cursor + options[i].label + '\n');
        lines++;
      }
      renderedLines = lines;
    };

    const cleanup = () => {
      input.removeListener('keypress', onKey);
      if (input.isTTY && typeof input.setRawMode === 'function') input.setRawMode(wasRaw);
    };

    const onKey = (_, key) => {
      if (!key) return;
      if (key.ctrl && key.name === 'c') {
        cleanup();
        reject(new Error('aborted'));
        return;
      }
      if (key.name === 'up' && idx > 0) { idx--; render(); }
      else if (key.name === 'down' && idx < options.length - 1) { idx++; render(); }
      else if (key.name === 'return') {
        cleanup();
        resolve(options[idx].value);
      }
    };

    input.on('keypress', onKey);
    if (typeof input.resume === 'function') input.resume();
    render();
  });
}

async function promptInstallParams({ detected, projectRoot, io }) {
  const targetOptions = TARGET_OPTIONS.map((o) => {
    if (o.value === 'both') return o;
    return { ...o, label: `${o.label} ${detected[o.value] ? '(detected)' : '(not detected)'}` };
  });

  const target = await ask({
    question: 'Which agent(s) to instrument?',
    options: targetOptions,
    initial: pickTargetDefault(detected),
    io,
  });

  if (!projectRoot) {
    io.output.write('(no project detected — installing user-wide)\n');
    return { target, scope: 'user' };
  }

  // scope prompt added in Task 4
  return { target, scope: 'user' };
}

module.exports = { promptInstallParams, pickTargetDefault };

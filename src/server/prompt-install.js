'use strict';
// Interactive dialog for `agent-viz install-hooks` (zero flags + TTY).
// Pure dialog: takes detection + projectRoot + io streams, returns
// { target, scope }. No filesystem I/O, no install logic.

const readline = require('node:readline');
const { styleText } = require('node:util');

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
//
// IMPORTANT: this function does NOT touch raw mode, resume(), or pause().
// Those are owned by the caller (see openInteractiveSession) and are set
// ONCE per session — toggling them between consecutive ask() calls caused
// the OS to re-deliver a phantom \r on Windows TTY, which then auto-resolved
// the next prompt to its default option.
function ask({ question, options, initial, io }) {
  return new Promise((resolve, reject) => {
    const { input, output } = io;
    let idx = initial;
    let renderedLines = 0;

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
        const isSelected = i === idx;
        // `> ` cursor is kept as a fallback signal for NO_COLOR / non-TTY,
        // where styleText auto-disables and the cursor becomes the only
        // selection indicator.
        const cursor = isSelected ? '> ' : '  ';
        const line = cursor + options[i].label;
        output.write((isSelected ? styleText('blueBright', line) : line) + '\n');
        lines++;
      }
      renderedLines = lines;
    };

    const onKey = (_, key) => {
      if (!key) return;
      if (key.ctrl && key.name === 'c') {
        input.removeListener('keypress', onKey);
        reject(new Error('aborted'));
        return;
      }
      if (key.name === 'up' && idx > 0) { idx--; render(); }
      else if (key.name === 'down' && idx < options.length - 1) { idx++; render(); }
      else if (key.name === 'return') {
        input.removeListener('keypress', onKey);
        resolve(options[idx].value);
      }
    };

    input.on('keypress', onKey);
    render();
  });
}

// Open a single interactive TTY session: enable raw mode, attach the
// keypress emitter, resume the stream. Returns a `close()` that restores
// everything in reverse. Doing this ONCE per multi-question dialog (instead
// of per ask() call) avoids the Windows TTY phantom-\r bug described above.
function openInteractiveSession(io) {
  const { input } = io;
  const wasRaw = input.isTTY ? input.isRaw : null;
  if (input.isTTY && typeof input.setRawMode === 'function') input.setRawMode(true);
  readline.emitKeypressEvents(input);
  if (typeof input.resume === 'function') input.resume();

  return function close() {
    if (input.isTTY && typeof input.setRawMode === 'function') input.setRawMode(wasRaw);
    // Without pause()+unref(), stdin stays in flowing mode with internal
    // listeners attached by emitKeypressEvents, and the event loop refuses
    // to drain — install-hooks would hang on exit. unref() is the belt-and-
    // suspenders fix for Windows raw-mode TTY, where pause() alone has been
    // observed to leave the libuv tty handle active.
    if (typeof input.pause === 'function') input.pause();
    if (typeof input.unref === 'function') input.unref();
  };
}

async function promptInstallParams({ detected, projectRoot, io }) {
  const targetOptions = TARGET_OPTIONS.map((o) => {
    if (o.value === 'both') return o;
    return { ...o, label: `${o.label} ${detected[o.value] ? '(detected)' : '(not detected)'}` };
  });

  const close = openInteractiveSession(io);
  try {
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

    const scope = await ask({
      question: 'Where to install hooks?',
      options: SCOPE_OPTIONS,
      initial: 0,                                   // user
      io,
    });

    return { target, scope };
  } finally {
    close();
  }
}

module.exports = { promptInstallParams, pickTargetDefault };

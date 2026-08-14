'use strict';
// Interactive dialog for `agent-viz install-hooks` (zero flags + TTY).
// Pure dialog: takes detection + projectRoot + io streams, returns
// { target, scope }. No filesystem I/O, no install logic.

import readline from 'node:readline';
import { styleText } from 'node:util';

// Forme rendue par `detectAgents()` (install-hooks.ts, hors lot ce fichier-ci
// mais même lot 8) : un booléen par agent connu, jamais plus.
interface DetectedAgents {
  claude: boolean;
  copilot: boolean;
}

// Le flux d'entrée du dialogue. `readline.emitKeypressEvents` exige un
// `NodeJS.ReadableStream` — c'est la base de ce type ; les propriétés TTY
// restent optionnelles, comme en production où `process.stdin` peut ne pas
// être un TTY (piped stdin) et où les tests décorent un simple `PassThrough`.
type PromptInput = NodeJS.ReadableStream & {
  isTTY?: boolean;
  isRaw?: boolean;
  setRawMode?(mode: boolean): unknown;
  unref?(): unknown;
};

interface PromptOutput {
  write(chunk: string): unknown;
}

interface PromptIo {
  input: PromptInput;
  output: PromptOutput;
}

interface KeypressKey {
  name?: string;
  ctrl?: boolean;
}

interface SelectOption<T extends string> {
  value: T;
  label: string;
}

const TARGET_OPTIONS: SelectOption<'claude' | 'copilot' | 'both'>[] = [
  { value: 'claude',  label: 'Claude Code' },
  { value: 'copilot', label: 'Copilot CLI' },
  { value: 'both',    label: 'Both' },
];

const SCOPE_OPTIONS: SelectOption<'user' | 'project' | 'local'>[] = [
  { value: 'user',    label: 'user — works in every project' },
  { value: 'project', label: 'project — committed to this repo, shared with team' },
  { value: 'local',   label: 'local — this repo only, gitignored' },
];

function pickTargetDefault(detected: DetectedAgents): number {
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
function ask<T extends string>({ question, options, initial, io }: {
  question: string;
  options: SelectOption<T>[];
  initial: number;
  io: PromptIo;
}): Promise<T> {
  return new Promise<T>((resolve, reject) => {
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
      // `forEach` plutôt qu'un accès indexé : `noUncheckedIndexedAccess`
      // rendrait `options[i]` possiblement `undefined`, alors que la borne de
      // la boucle le garantit toujours défini — l'itération directe porte
      // cette garantie dans son propre type, sans assertion.
      options.forEach((opt, i) => {
        const isSelected = i === idx;
        // `> ` cursor is kept as a fallback signal for NO_COLOR / non-TTY,
        // where styleText auto-disables and the cursor becomes the only
        // selection indicator.
        const cursor = isSelected ? '> ' : '  ';
        const line = cursor + opt.label;
        output.write((isSelected ? styleText('blueBright', line) : line) + '\n');
        lines++;
      });
      renderedLines = lines;
    };

    const onKey = (_: unknown, key: KeypressKey | undefined) => {
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
        // `idx` reste dans [0, options.length) par construction (gardes
        // up/down ci-dessus) : la même garantie que `forEach` ci-dessus,
        // mais ici l'accès EST indexé — un seul `!`, à la frontière exacte
        // où l'invariant est vrai, plutôt qu'un repli silencieux qui
        // changerait le comportement (l'original levait ici si `idx` avait
        // pu sortir de la plage).
        resolve(options[idx]!.value);
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
function openInteractiveSession(io: PromptIo): () => void {
  const { input } = io;
  const wasRaw = input.isTTY ? input.isRaw : null;
  if (input.isTTY && typeof input.setRawMode === 'function') input.setRawMode(true);
  readline.emitKeypressEvents(input);
  if (typeof input.resume === 'function') input.resume();

  return function close() {
    // `wasRaw` n'est `null`/`undefined` QUE si `input.isTTY` était faux à sa
    // capture ci-dessus — exactement la garde qui protège cet appel. Un seul
    // `!` à cette frontière précise, pas un repli qui changerait le comportement.
    if (input.isTTY && typeof input.setRawMode === 'function') input.setRawMode(wasRaw!);
    // Without pause()+unref(), stdin stays in flowing mode with internal
    // listeners attached by emitKeypressEvents, and the event loop refuses
    // to drain — install-hooks would hang on exit. unref() is the belt-and-
    // suspenders fix for Windows raw-mode TTY, where pause() alone has been
    // observed to leave the libuv tty handle active.
    if (typeof input.pause === 'function') input.pause();
    if (typeof input.unref === 'function') input.unref();
  };
}

async function promptInstallParams({ detected, projectRoot, io }: {
  detected: DetectedAgents;
  projectRoot: string | null;
  io: PromptIo;
}): Promise<{ target: 'claude' | 'copilot' | 'both'; scope: 'user' | 'project' | 'local' }> {
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

export { promptInstallParams, pickTargetDefault };

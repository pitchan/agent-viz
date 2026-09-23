import { expect, test } from 'vitest';
import { parseCliArgs, UsageError } from '../src/engine/cli-args.ts';

test('--version donne la commande version', () => {
  expect(parseCliArgs(['--version'])).toEqual({ command: 'version' });
});

test('sans argument donne la commande help', () => {
  expect(parseCliArgs([])).toEqual({ command: 'help' });
});

test('doctor sans flag donne les défauts', () => {
  expect(parseCliArgs(['doctor'])).toEqual({
    command: 'doctor',
    doctor: { json: false, list: false },
  });
});

test('doctor avec flags les parse tous', () => {
  expect(
    parseCliArgs([
      'doctor',
      '--json',
      '--last',
      '5',
      '--project',
      'dvf',
      '--since',
      '7d',
      '--claude-dir',
      'C:\\tmp\\claude',
      '--max-prompts',
      '50',
    ]),
  ).toEqual({
    command: 'doctor',
    doctor: {
      json: true,
      list: false,
      last: 5,
      project: 'dvf',
      since: '7d',
      claudeDir: 'C:\\tmp\\claude',
      maxPrompts: 50,
    },
  });
});

test('--last non numérique est une UsageError', () => {
  expect(() => parseCliArgs(['doctor', '--last', 'abc'])).toThrow(UsageError);
});

test('flag inconnu est une UsageError', () => {
  expect(() => parseCliArgs(['doctor', '--bogus'])).toThrow(UsageError);
});

test('commande inconnue est une UsageError', () => {
  expect(() => parseCliArgs(['fixit'])).toThrow(UsageError);
});

test('router-hook est desormais une commande inconnue (retrait moteur de carte)', () => {
  expect(() => parseCliArgs(['router-hook'])).toThrow(UsageError);
});

test.each(['on', 'off', 'status'] as const)(
  '%s est desormais une commande inconnue (retrait moteur de carte)',
  (cmd) => {
    expect(() => parseCliArgs([cmd])).toThrow(UsageError);
  },
);

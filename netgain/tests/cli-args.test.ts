import { describe, expect, test } from 'vitest';
import { parseCliArgs, UsageError } from '../src/cli-args.js';

describe('parseCliArgs', () => {
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

  test('router-hook donne la commande router-hook', () => {
    expect(parseCliArgs(['router-hook'])).toEqual({ command: 'router-hook' });
  });

  test.each(['on', 'off', 'status'] as const)('%s sans dir donne install sans dir', (cmd) => {
    expect(parseCliArgs([cmd])).toEqual({ command: cmd, install: {} });
  });

  test.each(['on', 'off', 'status'] as const)('%s avec dir positionnel le capture', (cmd) => {
    expect(parseCliArgs([cmd, 'D:\\scratch\\repo'])).toEqual({
      command: cmd,
      install: { dir: 'D:\\scratch\\repo' },
    });
  });

  test('on avec 2 positionnels est une UsageError citant on', () => {
    expect(() => parseCliArgs(['on', 'a', 'b'])).toThrow(/on : un seul répertoire attendu/);
  });

  test('status avec un flag inconnu est une UsageError citant le flag', () => {
    expect(() => parseCliArgs(['status', '--bogus'])).toThrow(/--bogus/);
  });
});

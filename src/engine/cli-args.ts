import { parseArgs } from 'node:util';

export class UsageError extends Error {}

export interface DoctorCliOptions {
  json: boolean;
  list: boolean;
  project?: string;
  since?: string;
  last?: number;
  claudeDir?: string;
  maxPrompts?: number;
}

export interface InstallCliOptions {
  dir?: string;
}

export type CliCommand =
  | { command: 'version' }
  | { command: 'help' }
  | { command: 'router-hook' }
  | { command: 'on' | 'off' | 'status'; install: InstallCliOptions }
  | { command: 'doctor'; doctor: DoctorCliOptions };

export function parseCliArgs(argv: string[]): CliCommand {
  if (argv.includes('--version') || argv.includes('-v')) return { command: 'version' };
  const [cmd, ...rest] = argv;
  if (cmd === undefined || cmd === '--help' || cmd === '-h' || cmd === 'help') {
    return { command: 'help' };
  }
  if (cmd === 'router-hook') return { command: 'router-hook' };
  if (cmd === 'on' || cmd === 'off' || cmd === 'status') {
    let positionals: string[];
    try {
      ({ positionals } = parseArgs({ args: rest, options: {}, allowPositionals: true }));
    } catch (err) {
      throw new UsageError((err as Error).message);
    }
    if (positionals.length > 1) throw new UsageError(`${cmd} : un seul répertoire attendu`);
    const install: InstallCliOptions = {};
    if (positionals[0] !== undefined) install.dir = positionals[0];
    return { command: cmd, install };
  }
  if (cmd !== 'doctor') throw new UsageError(`commande inconnue : ${cmd}`);

  let values: Record<string, string | boolean | undefined>;
  try {
    ({ values } = parseArgs({
      args: rest,
      options: {
        json: { type: 'boolean', default: false },
        list: { type: 'boolean', default: false },
        project: { type: 'string' },
        since: { type: 'string' },
        last: { type: 'string' },
        'claude-dir': { type: 'string' },
        'max-prompts': { type: 'string' },
      },
      allowPositionals: false,
    }));
  } catch (err) {
    throw new UsageError((err as Error).message);
  }

  const doctor: DoctorCliOptions = {
    json: values['json'] === true,
    list: values['list'] === true,
  };
  if (typeof values['project'] === 'string') doctor.project = values['project'];
  if (typeof values['since'] === 'string') doctor.since = values['since'];
  if (typeof values['last'] === 'string') doctor.last = parsePositiveInt(values['last'], '--last');
  if (typeof values['claude-dir'] === 'string') doctor.claudeDir = values['claude-dir'];
  if (typeof values['max-prompts'] === 'string') {
    doctor.maxPrompts = parsePositiveInt(values['max-prompts'], '--max-prompts');
  }
  return { command: 'doctor', doctor };
}

function parsePositiveInt(raw: string, flag: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new UsageError(`${flag} attend un entier positif, reçu « ${raw} »`);
  }
  return n;
}

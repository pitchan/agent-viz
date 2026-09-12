#!/usr/bin/env node
import { parseCliArgs, UsageError } from './cli-args.ts';
import { readPackageVersion } from './version.ts';

const HELP = `netgain — mesurer net, jamais brut (local-only, lecture seule)

Usage :
  netgain doctor [options]   distribution factuelle des tokens de vos sessions Claude Code
  netgain --version
  netgain --help

Options de doctor :
  --project <substr>    ne garder que les projets dont le chemin contient <substr>
  --since <ISO|7d|30d>  ne garder que les sessions plus récentes
  --last <N>            ne garder que les N sessions les plus récentes
  --json                rapport JSON complet sur stdout (au lieu du rendu terminal)
  --list                lister projets/sessions découverts, sans scanner
  --claude-dir <dir>    racine à scanner (défaut : ~/.claude, env CLAUDE_CONFIG_DIR)
  --max-prompts <N>     plafond du corpus de prompts dans le rapport
`;

async function main(): Promise<number> {
  let cli;
  try {
    cli = parseCliArgs(process.argv.slice(2));
  } catch (err) {
    if (err instanceof UsageError) {
      process.stderr.write(`netgain : ${err.message}\n\n${HELP}`);
      return 2;
    }
    throw err;
  }

  switch (cli.command) {
    case 'version': {
      process.stdout.write(`netgain ${readPackageVersion()}\n`);
      return 0;
    }
    case 'help': {
      process.stdout.write(HELP);
      return 0;
    }
    case 'doctor': {
      const { runDoctorCli } = await import('./doctor/index.ts');
      return runDoctorCli(cli.doctor);
    }
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    process.stderr.write(`netgain : erreur inattendue : ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    process.exitCode = 1;
  },
);

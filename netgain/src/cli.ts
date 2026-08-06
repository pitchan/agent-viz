#!/usr/bin/env node
import { parseCliArgs, UsageError } from './cli-args.js';
import { readPackageVersion } from './version.js';

const HELP = `netgain — mesurer net, jamais brut (local-only, lecture seule)

Usage :
  netgain on [dir]           activer map+router pour ce repo : pose exactement 2 entrées
                             (MCP local ~/.claude.json + hook .claude/settings.local.json)
                             MCP pris en compte au prochain démarrage de session ; hook à chaud
  netgain off [dir]          retirer exactement ces 2 entrées (idempotent)
  netgain status [dir]       état scriptable — exit 0 = ON complet, 1 = OFF/partiel, 2 = usage
  netgain doctor [options]   distribution factuelle des tokens de vos sessions Claude Code
  netgain router-hook        hook UserPromptSubmit : nudge map_impact/map_hot sur signal de graphe, silence sinon
  netgain --version
  netgain --help

Options de doctor :
  --project <substr>    ne garder que les projets dont le chemin contient <substr>
  --since <ISO|7d|30d>  ne garder que les sessions plus récentes
  --last <N>            ne garder que les N sessions les plus récentes
  --json                rapport JSON complet sur stdout (au lieu du rendu terminal)
  --list                lister projets/sessions découverts, sans scanner
  --claude-dir <dir>    racine à scanner (défaut : ~/.claude, env NETGAIN_CLAUDE_DIR)
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
    case 'router-hook': {
      const { runRouterHookCli } = await import('./router/hook.js');
      return runRouterHookCli();
    }
    case 'on': {
      const { runOnCli } = await import('./install/index.js');
      return runOnCli(cli.install);
    }
    case 'off': {
      const { runOffCli } = await import('./install/index.js');
      return runOffCli(cli.install);
    }
    case 'status': {
      const { runStatusCli } = await import('./install/index.js');
      return runStatusCli(cli.install);
    }
    case 'doctor': {
      const { runDoctorCli } = await import('./doctor/index.js');
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

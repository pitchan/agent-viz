#!/usr/bin/env node
'use strict';
// agent-viz CLI dispatcher.
//
// Usage :
//   agent-viz [start] [--port N] [--foreground] [--no-install-hooks] [--open]
//   agent-viz stop  [--keep-hooks]
//   agent-viz status
//   agent-viz install-hooks   [--user|--project|--local]
//   agent-viz uninstall-hooks [--user|--project|--local]
//   agent-viz hook            (internal — invoked by Claude Code via settings.json)
//   agent-viz --help | --version

import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { parseArgs, styleText } from 'node:util';
import { pathToFileURL } from 'node:url';
import pkg from '../package.json' with { type: 'json' };

const PKG_ROOT = path.resolve(import.meta.dirname, '..');
// Le chargeur JSON de Node lit package.json au démarrage et retire le BOM ; un
// fichier absent arrête le binaire plutôt que d'afficher une version inventée.
const PKG_VERSION = pkg.version;

// Semantic color helpers. node:util.styleText auto-disables for non-TTY
// streams and respects NO_COLOR (https://no-color.org), so call sites stay
// clean — no manual gating. Wrapped to centralize convention: ok=green for
// successes, hint=cyan for pointers/URLs, dim=gray for technical detail
// (paths, pids, scopes), warn=yellow for soft warnings, err=red for errors.
const c = {
  ok:   (s) => styleText('green',  s),
  hint: (s) => styleText('cyan',   s),
  dim:  (s) => styleText('gray',   s),
  warn: (s) => styleText('yellow', s),
  err:  (s) => styleText('red',    s),
};

// Copie de TARGETS du registre : l'analyse des options la vérifie avant de
// charger dist/. tests/repo/cli-flags et bin-help la comparent au registre.
const TARGETS = ['claude', 'copilot', 'both'];

function help() {
  console.log(`agent-viz v${PKG_VERSION}

Usage:
  agent-viz [start]              Start the visualizer (default).
                                   --port N           listen on port N (default 3333)
                                   --foreground       attach to terminal (don't daemonize)
                                   --no-install-hooks don't auto-install hooks
                                   --open             open browser to the URL
  agent-viz stop                 Stop the running visualizer (also removes hooks).
                                   --keep-hooks       keep hooks installed (symmetric to start --no-install-hooks)
  agent-viz status               Show running state + URL.
  agent-viz install-hooks        Install hooks. Default: auto-detect (Claude + Copilot if present).
                                   --target=${TARGETS.join('|')}   force a target
                                   --user             user-level config (~/.claude or ~/.copilot) — default
                                   --project          repo-committed config
                                   --local            repo-local gitignored config
                                   --check            audit instead of installing (exit 1 on stale/missing)
  agent-viz uninstall-hooks      Remove hooks (sweeps all targets unless --target given).
  agent-viz hook                 Internal — read JSON event from stdin.
                                   --source=claude|copilot   set the source agent tag
  agent-viz [<command>] --help   Show this help (never runs the command).
  agent-viz --version            Print version.

Before changing or deleting a hooks file, agent-viz copies it to ~/.agent-viz/backups/ (last 30 copies per file).
`);
}

// Les options que chaque sous-commande accepte. `hook` n'y figure pas : Claude
// Code bloque l'outil en cours sur un code 2, et hook.ts lit seul ses arguments.
// parseArgs ignore la clé `choices` : parseCommandOptions la vérifie après lui.
const COMMAND_OPTIONS = {
  start: {
    port: { type: 'string' },
    foreground: { type: 'boolean' },
    'install-hooks': { type: 'boolean' },
    open: { type: 'boolean' },
  },
  stop: { 'keep-hooks': { type: 'boolean' } },
  status: {},
  'install-hooks': {
    user: { type: 'boolean' },
    project: { type: 'boolean' },
    local: { type: 'boolean' },
    check: { type: 'boolean' },
    target: { type: 'string', choices: TARGETS },
  },
  'uninstall-hooks': {
    user: { type: 'boolean' },
    project: { type: 'boolean' },
    local: { type: 'boolean' },
    target: { type: 'string', choices: TARGETS },
  },
};

function wantsHelp(argv) {
  return argv.includes('--help') || argv.includes('-h') || argv[0] === 'help';
}

function wantsVersion(argv) {
  return argv.includes('--version') || argv.includes('-v');
}

function refuseOption(cmd, reason) {
  console.error(`${c.err('✗')} ${cmd}: ${reason}`);
  console.error("  Run 'agent-viz --help' to list the options.");
  process.exit(2);
}

// Une option non déclarée est refusée avant tout effet : ignorée, une faute de
// frappe comme `stop --keep-hook` retirait les hooks sans un mot. Même refus pour
// une valeur hors de `choices` : `--target=cloude` agirait sur les agents détectés.
function parseCommandOptions(cmd, args) {
  const options = COMMAND_OPTIONS[cmd];
  let values;
  try {
    values = parseArgs({ args, options, strict: true, allowPositionals: false, allowNegative: true }).values;
  } catch (e) {
    if (!String(e.code).startsWith('ERR_PARSE_ARGS_')) throw e;
    refuseOption(cmd, e.message.split('. ')[0]);
  }
  for (const [name, { choices }] of Object.entries(options)) {
    const value = values[name];
    if (choices && value !== undefined && !choices.includes(value)) {
      refuseOption(cmd, `Option '--${name}' must be one of ${choices.join('|')}, got '${value}'`);
    }
  }
  return values;
}

// Mtime le plus recent parmi les `.ts` sous `dir`, recursif. 0 si `dir`
// n'existe pas ou ne contient aucun `.ts` — un plancher neutre pour la
// comparaison de `ensureBuildIsFresh`, jamais lu comme une vraie date.
function newestTsMtime(dir) {
  let max = 0;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return max; }
  for (const entry of entries) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      max = Math.max(max, newestTsMtime(p));
    } else if (entry.isFile() && p.endsWith('.ts')) {
      try { max = Math.max(max, fs.statSync(p).mtimeMs); } catch {}
    }
  }
  return max;
}

// Fichiers reellement charges par les commandes, pas seulement le dossier
// dist/server : un dossier present mais vide, ou dist/engine absent a cote
// d'un dist/server intact, doivent aussi faire echouer la garde.
const REQUIRED_DIST_FILES = [
  ['server', 'lifecycle.js'],
  // Le démon lui-même. `lifecycle` le lance par `spawn(process.execPath, …)` :
  // Node existe toujours, donc l'absence de ce fichier ne se voit qu'en queue de
  // journal, en « Cannot find module », le message que cette garde doit éviter.
  ['server', 'server.js'],
  ['server', 'install-hooks.js'],
  ['server', 'prompt-install.js'],
  ['server', 'hook.js'],
  ['server', 'cli.js'],
  ['engine', 'core', 'index.js'],
  ['engine', 'doctor', 'index.js'],
].map(segs => path.join(PKG_ROOT, 'dist', ...segs));

// Une seule garde avant le branchement : les commandes plus bas chargent dist/*.js.
// Fichier compile absent = fatal, rien ne peut tourner. Source .ts plus recente que
// le temoin de tsc -b = avertissement : la commande servirait l'ancien code sans un mot.
function ensureBuildIsFresh(cmd) {
  const isDevRepo = fs.existsSync(path.join(PKG_ROOT, 'src', 'server'));
  const missing = REQUIRED_DIST_FILES.filter(f => !fs.existsSync(f));
  if (missing.length > 0) {
    if (isDevRepo) {
      console.error(`${c.err('✗')} agent-viz is not built (or the build is incomplete). Run \`npm run build\`.`);
    } else {
      console.error(`${c.err('✗')} agent-viz's install looks damaged: some compiled files are missing. Reinstall the package.`);
    }
    process.exit(1);
  }

  if (!isDevRepo || cmd === 'hook') return;

  const witness = path.join(PKG_ROOT, 'dist', 'tsconfig.build.tsbuildinfo');
  let witnessMtime;
  try {
    witnessMtime = fs.statSync(witness).mtimeMs;
  } catch {
    console.error(`${c.warn('!')} can't tell if the build is fresh: no compilation witness found (dist/tsconfig.build.tsbuildinfo is missing). Run \`npm run build\` if unsure.`);
    return;
  }

  const newestSource = Math.max(
    newestTsMtime(path.join(PKG_ROOT, 'src', 'engine')),
    newestTsMtime(path.join(PKG_ROOT, 'src', 'server')),
  );
  if (newestSource > witnessMtime) {
    console.error(`${c.warn('!')} a .ts source under src/engine or src/server changed after the last \`npm run build\`. Re-run it to pick up the change.`);
  }
}

// First-run welcome: npm 9+ silences install-script stdout by default
// (foreground-scripts=false), and an increasing share of users disable
// install scripts entirely (--ignore-scripts, pnpm 10+, Bun by default).
// So we don't ship a postinstall hook — onboarding is surfaced here on
// the first agent-viz invocation, persisted via a sentinel file in
// ~/.agent-viz/. Skipped for the internal `hook` subcommand (would
// pollute the event hot path); --help and --version never reach it.
function showFirstRunWelcomeIfNeeded(argv) {
  if (argv[0] === 'hook') return;
  const sentinelDir = path.join(os.homedir(), '.agent-viz');
  const sentinel = path.join(sentinelDir, '.welcomed');
  if (fs.existsSync(sentinel)) return;
  console.log('');
  console.log(`${c.ok('✓')} Welcome to agent-viz!`);
  console.log('');
  console.log('  Get started:');
  console.log(`    ${c.ok('agent-viz install-hooks')}    ${c.hint('←')} configure Claude/Copilot hooks (interactive)`);
  console.log(`    ${c.ok('agent-viz')}                  start the dashboard at http://localhost:3333`);
  console.log(`    ${c.dim('agent-viz --help')}           list all commands`);
  console.log('');
  try {
    fs.mkdirSync(sentinelDir, { recursive: true });
    fs.writeFileSync(sentinel, new Date().toISOString());
  } catch {}
}

const KNOWN_COMMANDS = ['start', 'stop', 'status', 'install-hooks', 'uninstall-hooks', 'hook'];

async function main() {
  const argv = process.argv.slice(2);
  // L'aide et la version passent avant tout le reste : la bienvenue écrit un
  // témoin, la garde de build peut arrêter le processus, une commande agit dès
  // qu'elle démarre.
  if (wantsHelp(argv)) {
    help();
    return;
  }
  if (wantsVersion(argv)) {
    console.log(PKG_VERSION);
    return;
  }

  const cmd = argv[0] && !argv[0].startsWith('-') ? argv[0] : 'start';
  const rest = argv[0] && !argv[0].startsWith('-') ? argv.slice(1) : argv;
  const flags = Object.hasOwn(COMMAND_OPTIONS, cmd) ? parseCommandOptions(cmd, rest) : null;

  showFirstRunWelcomeIfNeeded(argv);
  ensureBuildIsFresh(cmd);

  if (!KNOWN_COMMANDS.includes(cmd)) {
    console.error(`${c.err('Unknown command:')} ${cmd}\n`);
    help();
    process.exit(2);
  }

  const mod = await import(pathToFileURL(path.join(PKG_ROOT, 'dist', 'server', 'cli.js')).href);
  switch (cmd) {
    case 'start':            return mod.cmdStart(flags, PKG_ROOT);
    case 'stop':             return mod.cmdStop(flags, PKG_ROOT);
    case 'status':           return mod.cmdStatus(flags, PKG_ROOT);
    case 'install-hooks':    return mod.cmdInstallHooks(flags, PKG_ROOT);
    case 'uninstall-hooks':  return mod.cmdUninstallHooks(flags, PKG_ROOT);
    case 'hook':             return mod.cmdHook(PKG_ROOT);
    // Inatteignable tant que COMMAND_OPTIONS, KNOWN_COMMANDS et ces `case` restent
    // synchronisés — c'est justement le filet : un nom ajouté à KNOWN_COMMANDS sans
    // `case` assorti tomberait ici plutôt que de rendre 0 en silence.
    default:
      console.error(`${c.err('Unknown command:')} ${cmd}\n`);
      help();
      process.exit(2);
  }
}

main().catch(e => {
  console.error(`${c.err('✗')} ${e.stack || e.message}`);
  process.exit(1);
});

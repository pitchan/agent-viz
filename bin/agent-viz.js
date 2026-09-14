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
import { spawn } from 'node:child_process';
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

function pickScopeFlag(flags) {
  if (flags.user) return 'user';
  if (flags.project) return 'project';
  if (flags.local) return 'local';
  return undefined;
}

function openBrowser(url) {
  const isWin = process.platform === 'win32';
  const cmd = process.platform === 'darwin' ? 'open'
            : isWin ? 'cmd'
            : 'xdg-open';
  // On Windows, `start` is a cmd.exe builtin (not an executable), and the
  // empty "" arg is the title slot required when the URL itself is quoted.
  const args = isWin ? ['/c', 'start', '', url] : [url];
  const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
  // ENOENT and friends arrive asynchronously on the 'error' event, not as a
  // sync throw — silence them so a missing browser launcher never kills the CLI.
  child.on('error', () => {});
  child.unref();
}

// Sans --port ni PORT, le port reste indéfini : la valeur par défaut appartient
// à lifecycle, qui la connaît seul.
function requestedPort(flags) {
  const valeur = flags.port || process.env.PORT;
  return valeur ? parseInt(valeur, 10) : undefined;
}

async function cmdStart(flags) {
  const port = requestedPort(flags);
  // Default install-hooks=true unless --no-install-hooks given.
  const shouldInstall = flags['install-hooks'] !== false;

  if (shouldInstall) {
    const { install } = await import(pathToFileURL(path.join(PKG_ROOT, 'dist', 'server', 'install-hooks.js')).href);
    try {
      const result = install({ cwd: process.cwd(), packageRoot: PKG_ROOT });
      let printed = false;
      for (const [agent, r] of Object.entries(result)) {
        if (!r) continue;
        const label = agent === 'claude' ? 'Claude Code' : 'Copilot CLI';
        if (r.error) {
          // Ne plus dire « skipped » pour TOUS quand un SEUL refuse : les hooks
          // de l'autre agent sont posés, et le disaient déjà avant ce message.
          console.error(`${c.warn('!')} ${label} hooks not installed: ${r.error}`);
          continue;
        }
        if (r.action === 'noop') continue;
        const verb = r.action === 'updated' ? 'refreshed'
                   : r.action === 'installed+updated' ? 'installed + refreshed'
                   : 'installed';
        console.log(`${c.ok('✓')} ${label} hooks ${verb} ${c.hint('→')} ${c.dim(r.target.file)}`);
        console.log(c.dim(`  scope: ${r.target.scope}, mode: ${r.command.mode}`));
        if (r.missing && r.missing.length > 0) console.log(`  added on: ${r.missing.join(', ')}`);
        if (r.updated && r.updated.length > 0) console.log(`  refreshed on (was stale): ${r.updated.join(', ')}`);
        if (r.gitignore && r.gitignore.changed) {
          console.log(`  + .gitignore : added ${agent === 'claude' ? '.claude/settings.local.json' : '.github/hooks/agent-viz.local.json'}`);
        }
        printed = true;
      }
      if (printed) console.log(`  ${c.hint('→')} reopen /hooks in your agent (or restart) to reload settings.`);
    } catch (e) {
      console.error(`${c.warn('!')} hook install skipped: ${e.message}`);
    }
  }

  const { start, status } = await import(pathToFileURL(path.join(PKG_ROOT, 'dist', 'server', 'lifecycle.js')).href);
  try {
    const res = await start({ port, foreground: flags.foreground });
    if (res.foreground) {
      process.exit(res.exitCode || 0);
    }
    if (res.alreadyRunning) {
      console.log(`agent-viz already running ${c.hint('→')} http://localhost:${res.port}  ${c.dim(`(pid ${res.pid})`)}`);
    } else {
      console.log(`${c.ok('✓')} agent-viz started ${c.hint('→')} http://localhost:${res.port}  ${c.dim(`(pid ${res.pid})`)}`);
    }
    if (flags.open) openBrowser(`http://localhost:${res.port}`);
  } catch (e) {
    console.error(`${c.err('✗')} ${e.message}`);
    process.exit(1);
  }
}

async function cmdStop(flags) {
  const { stop, status } = await import(pathToFileURL(path.join(PKG_ROOT, 'dist', 'server', 'lifecycle.js')).href);
  const port = requestedPort(flags);
  const before = await status({ port });
  let res = null;
  if (before.running) {
    res = await stop({ port });
  } else {
    console.log('agent-viz not running.');
  }

  // Mirror of cmdStart's auto-install: stop also removes hooks unless opted out.
  // We target the SAME scope `start` would have resolved from this cwd
  // (`resolveScope` returns 'local' if a project root is found, else 'user'),
  // so unrelated installs in other scopes are preserved. Sweeps both agents —
  // uninstalling an agent that was never installed is a no-op.
  const shouldUninstall = flags['keep-hooks'] !== true;
  if (shouldUninstall) {
    const { uninstall, resolveScope } = await import(pathToFileURL(path.join(PKG_ROOT, 'dist', 'server', 'install-hooks.js')).href);
    try {
      const scoped = resolveScope({ cwd: process.cwd(), packageRoot: PKG_ROOT });
      const result = uninstall({ scope: scoped.scope, cwd: process.cwd(), packageRoot: PKG_ROOT });
      let totalRemoved = 0;
      for (const [agent, x] of Object.entries(result)) {
        const label = agent === 'claude' ? 'Claude Code' : 'Copilot CLI';
        if (x.error) {
          // Le signal d'echec ne doit jamais se perdre ici (décision D3) : stop
          // retire des hooks de maniere routiniere, donc un refus tu = des
          // hooks qui restent poses et continuent de se declencher sans que
          // l'utilisateur le sache.
          //
          // Le refus est IMPRIME, mais ne fixe PAS le code de sortie — et c'est
          // deliberé, meme regle que `cmdStart` : le code de sortie de `start` /
          // `stop` rend compte du CYCLE DE VIE DU SERVEUR, leur unique objet.
          // Le retrait des hooks y est un service annexe, explicitement
          // desactivable (`--keep-hooks` / `--no-install-hooks`) : laisser des
          // hooks en place est un mode supporte de la commande, donc pas un
          // echec de la commande. Les codes de sortie QUI PARLENT DES HOOKS
          // sont ceux des commandes dediees, `install-hooks` et
          // `uninstall-hooks` — elles, sortent 1 (D3).
          console.log(`${c.err('✗')} ${label} hooks NOT removed: ${x.error}`);
          continue;
        }
        for (const r of (x.results || [])) {
          if (r.removed > 0) {
            totalRemoved += r.removed;
            console.log(`${c.ok('✓')} ${label} hooks removed ${c.hint('→')} ${c.dim(r.file)} (${r.scope})`);
          }
        }
      }
      if (totalRemoved > 0) {
        console.log(c.dim('  (use `agent-viz stop --keep-hooks` to preserve hooks next time)'));
      }
    } catch (e) {
      console.error(`${c.warn('!')} hook uninstall skipped: ${e.message}`);
    }
  }

  if (res) {
    console.log(`${c.ok('✓')} agent-viz stopped ${c.dim(`(port ${res.port}${res.viaShutdown ? ', graceful' : ', forced'}).`)}`);
  }
}

async function cmdStatus(flags) {
  const { status } = await import(pathToFileURL(path.join(PKG_ROOT, 'dist', 'server', 'lifecycle.js')).href);
  const { installedScopes } = await import(pathToFileURL(path.join(PKG_ROOT, 'dist', 'server', 'install-hooks.js')).href);
  const s = await status({ port: requestedPort(flags) });
  if (s.running) {
    console.log(`${c.ok('running')} ${c.hint('→')} http://localhost:${s.port}`);
    if (s.pid) console.log(c.dim(`pid     : ${s.pid}`));
    if (s.startedAt) console.log(c.dim(`started : ${s.startedAt}`));
    console.log(c.dim(`log     : ${s.log}`));
  } else {
    console.log(c.dim('not running.'));
    if (s.stale) console.log(c.dim(`(stale pid file cleared: pid ${s.stale.pid})`));
    console.log(c.dim(`log     : ${s.log}`));
  }

  const scopes = installedScopes({ cwd: process.cwd(), packageRoot: PKG_ROOT });
  const lines = [];
  for (const [agent, list] of Object.entries(scopes)) {
    if (!list || list.length === 0) continue;
    const label = agent === 'claude' ? 'Claude Code' : 'Copilot CLI';
    const names = list.map(x => x.scope).join(', ');
    const dup = list.length > 1 ? c.warn(`  ! duplicate: each event fires ${list.length}x`) : '';
    lines.push(`  ${label.padEnd(11)} : ${names}${dup}`);
  }
  if (lines.length > 0) {
    console.log('hooks   :');
    for (const l of lines) console.log(l);
  }
}

async function cmdInstallHooks(flags) {
  let scope = pickScopeFlag(flags);
  let target = flags.target;
  const { install, audit, detectAgents, findProjectRoot } = await import(pathToFileURL(path.join(PKG_ROOT, 'dist', 'server', 'install-hooks.js')).href);

  // Zero-flag invocation (no scope, no target, not --check) opens an
  // interactive prompt asking which agent + which scope. --check stays
  // non-interactive (audit mode). Any flag bypasses the prompt entirely.
  const noFlags = !scope && !target && !flags.check;
  if (noFlags) {
    if (!process.stdin.isTTY) {
      console.error(`${c.err('✗')} install-hooks needs a TTY for interactive prompts.`);
      console.error('  Pass flags to install non-interactively, e.g.');
      console.error(c.dim('    agent-viz install-hooks --user --target=both'));
      process.exit(1);
    }
    const { promptInstallParams } = await import(pathToFileURL(path.join(PKG_ROOT, 'dist', 'server', 'prompt-install.js')).href);
    const detected = detectAgents();
    const projectRoot = findProjectRoot(process.cwd(), { packageRoot: PKG_ROOT });
    try {
      ({ target, scope } = await promptInstallParams({
        detected,
        projectRoot,
        io: { input: process.stdin, output: process.stdout },
      }));
    } catch (e) {
      if (e.message === 'aborted') process.exit(130);
      throw e;
    }
  }

  if (flags.check) {
    const result = audit({ target, scope, cwd: process.cwd(), packageRoot: PKG_ROOT });
    let exitCode = 0;
    for (const [agent, a] of Object.entries(result)) {
      const label = agent === 'claude' ? 'Claude Code' : 'Copilot CLI';
      // `audit` passe par le registre, qui traduit tout refus en `{ error }` :
      // un fichier de hooks illisible fait lever la lecture. Sans cette garde,
      // `--check` imprimait « settings : undefined » puis mourait sur
      // `a.audit is not iterable`, en ne nommant plus le fichier fautif.
      if (a.error) {
        console.log(`${label}:`);
        console.log(`  ${c.err('✗')} ${a.error}`);
        exitCode = 1;
        continue;
      }
      console.log(`${label}:`);
      console.log(c.dim(`  settings : ${a.file}  (scope: ${a.scope})`));
      for (const { event, installed, stale, others } of a.audit) {
        const flag = installed ? (stale ? c.warn('~') : c.ok('x')) : c.err(' ');
        const tags = [];
        if (stale) tags.push('stale');
        if (others > 0) tags.push(`+${others} other`);
        console.log(`  [${flag}] ${event}${tags.length ? c.dim('   (' + tags.join(', ') + ')') : ''}`);
        if (!installed || stale) exitCode = 1;
      }
    }
    process.exit(exitCode);
  }

  const result = install({ target, scope, cwd: process.cwd(), packageRoot: PKG_ROOT });
  let refused = false;
  for (const [agent, r] of Object.entries(result)) {
    const label = agent === 'claude' ? 'Claude Code' : 'Copilot CLI';
    if (r.error) {
      console.log(`${label}:`);
      console.log(`  ${c.err('✗')} ${r.error}`);
      refused = true;
      continue;
    }
    console.log(`${label}:`);
    console.log(c.dim(`  settings : ${r.target.file}  (scope: ${r.target.scope})`));
    console.log(c.dim(`  hook cmd : ${r.command.command}  (mode: ${r.command.mode})`));
    if (r.action === 'noop') {
      console.log(`  ${c.ok('✓')} already installed and up to date.`);
    } else {
      if (r.missing && r.missing.length > 0) console.log(`  ${c.ok('✓')} added: ${r.missing.join(', ')}`);
      if (r.updated && r.updated.length > 0) console.log(`  ${c.ok('✓')} refreshed (was stale): ${r.updated.join(', ')}`);
      if (r.present && r.present.length > 0) console.log(c.dim(`  (already up to date: ${r.present.join(', ')})`));
    }
    const others = Object.entries(r.coexisting || {});
    if (others.length > 0) {
      console.log('  Coexisting hooks (run in parallel, untouched):');
      for (const [ev, n] of others) console.log(c.dim(`    - ${ev}: ${n} other(s)`));
    }
    if (r.gitignore && r.gitignore.changed) {
      console.log(`  + .gitignore : added ${agent === 'claude' ? '.claude/settings.local.json' : '.github/hooks/agent-viz.local.json'}`);
    }
    if (r.crossScope && r.crossScope.length > 0) {
      const others = r.crossScope.map(s => s.scope).join(', ');
      console.log(`  ${c.warn('!')} hooks also installed in: ${others}`);
      console.log(c.dim(`    each event will fire ${1 + r.crossScope.length}x (one per scope) — uninstall the extras with`));
      for (const s of r.crossScope) {
        console.log(c.dim(`      agent-viz uninstall-hooks --${s.scope} --target=${agent}`));
      }
    }
  }
  const anyChange = Object.values(result).some(r => r && r.action && r.action !== 'noop');
  if (anyChange) {
    console.log(`\n${c.hint('→')} Reopen /hooks in your agent (or restart) to reload settings.`);
    console.log(`  To uninstall later: run \`${c.ok('agent-viz uninstall-hooks')}\` BEFORE \`npm uninstall\``);
    console.log(c.dim('  (npm 7+ does not run lifecycle scripts on uninstall — manual cleanup required).'));
  }
  if (refused) process.exitCode = 1;
}

async function cmdUninstallHooks(flags) {
  const scope = pickScopeFlag(flags);
  const target = flags.target;
  const { uninstall } = await import(pathToFileURL(path.join(PKG_ROOT, 'dist', 'server', 'install-hooks.js')).href);
  const result = uninstall({ target, scope, cwd: process.cwd(), packageRoot: PKG_ROOT });
  let total = 0;
  let failed = false;
  for (const [agent, x] of Object.entries(result)) {
    const label = agent === 'claude' ? 'Claude Code' : 'Copilot CLI';
    if (x.error) {
      console.log(`${label}: ${c.err('✗')} ${x.error}`);
      failed = true;
      continue;
    }
    const results = x.results || [];
    for (const r of results) {
      total += r.removed;
      if (r.removed > 0) console.log(`${label}: ${c.ok('✓')} removed ${r.removed} from ${c.dim(r.file)} (${r.scope})`);
      else if (r.exists) console.log(c.dim(`${label}:   nothing to remove in ${r.file} (${r.scope})`));
      else console.log(c.dim(`${label}:   ${r.file} does not exist (${r.scope})`));
    }
  }
  // Une erreur ne doit jamais se lire comme « rien à retirer » (décision D3) :
  // le total peut rester a 0 alors qu un agent n a pas pu etre traite du tout.
  if (total === 0 && !failed) console.log(c.dim('No agent-viz hooks found.'));
  // …ni comme un succes pour le script qui appelle (D3, le code de sortie).
  // Avant que le registre ne traduise le refus en valeur, la levee sortait 1 ;
  // sortir 0 en annoncant « hooks NOT removed » ferait lire un succes a une
  // etape de CI alors que les hooks restent poses et continuent de tirer.
  if (failed) process.exitCode = 1;
}

async function cmdHook() {
  // Internal: forwarded by Claude Code via settings.json.
  const { runHook } = await import(pathToFileURL(path.join(PKG_ROOT, 'dist', 'server', 'hook.js')).href);
  runHook();
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
  ['server', 'install-hooks.js'],
  ['server', 'prompt-install.js'],
  ['server', 'hook.js'],
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

  switch (cmd) {
    case 'start':            return cmdStart(flags);
    case 'stop':             return cmdStop(flags);
    case 'status':           return cmdStatus(flags);
    case 'install-hooks':    return cmdInstallHooks(flags);
    case 'uninstall-hooks':  return cmdUninstallHooks(flags);
    case 'hook':             return cmdHook();
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

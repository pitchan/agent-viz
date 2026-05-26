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

const path = require('path');
const fs = require('fs');
const { styleText } = require('node:util');

const PKG_ROOT = path.resolve(__dirname, '..');
let PKG_VERSION = '0.0.0';
try { PKG_VERSION = require(path.join(PKG_ROOT, 'package.json')).version || '0.0.0'; } catch {}

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
                                   --target=claude|copilot|both   force a target
                                   --user             user-level config (~/.claude or ~/.copilot)
                                   --project          repo-committed config
                                   --local            repo-local gitignored config (default in project)
                                   --check            audit instead of installing (exit 1 on stale/missing)
  agent-viz uninstall-hooks      Remove hooks (sweeps all targets unless --target given).
  agent-viz hook                 Internal — read JSON event from stdin.
                                   --source=claude|copilot   set the source agent tag
  agent-viz --help               Show this help.
  agent-viz --version            Print version.
`);
}

function parseFlags(argv, allowed = {}) {
  // allowed: { booleans: ['foreground', ...], values: ['port'] }
  const booleans = new Set(allowed.booleans || []);
  const values = new Set(allowed.values || []);
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--no-') && booleans.has(a.slice(5))) {
      out[a.slice(5)] = false;
    } else if (a.startsWith('--')) {
      const key = a.slice(2);
      if (booleans.has(key)) {
        out[key] = true;
      } else if (values.has(key)) {
        out[key] = argv[++i];
      } else if (key.includes('=')) {
        const [k, v] = key.split('=', 2);
        out[k] = v;
      } else {
        out[key] = true;
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

function pickScopeFlag(flags) {
  if (flags.user) return 'user';
  if (flags.project) return 'project';
  if (flags.local) return 'local';
  return undefined;
}

function pickTargetFlag(flags) {
  const v = flags.target;
  if (v === 'claude' || v === 'copilot' || v === 'both') return v;
  return undefined;
}

function openBrowser(url) {
  const { spawn } = require('child_process');
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

async function cmdStart(argv) {
  const flags = parseFlags(argv, {
    booleans: ['foreground', 'install-hooks', 'open'],
    values: ['port'],
  });
  const port = parseInt(flags.port || process.env.PORT || '3333', 10);
  // Default install-hooks=true unless --no-install-hooks given.
  const shouldInstall = flags['install-hooks'] !== false;

  if (shouldInstall) {
    const { install } = require(path.join(PKG_ROOT, 'lib', 'install-hooks.js'));
    try {
      const result = install({ cwd: process.cwd(), packageRoot: PKG_ROOT, version: PKG_VERSION });
      let printed = false;
      for (const [agent, r] of Object.entries(result)) {
        if (!r || r.action === 'noop') continue;
        const label = agent === 'claude' ? 'Claude Code' : 'Copilot CLI';
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

  const { start, status } = require(path.join(PKG_ROOT, 'lib', 'lifecycle.js'));
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

async function cmdStop(argv) {
  const flags = parseFlags(argv || [], { booleans: ['keep-hooks'] });
  const { stop, status } = require(path.join(PKG_ROOT, 'lib', 'lifecycle.js'));
  const before = await status();
  let res = null;
  if (before.running) {
    res = await stop();
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
    const { uninstall, resolveScope } = require(path.join(PKG_ROOT, 'lib', 'install-hooks.js'));
    try {
      const scoped = resolveScope({ cwd: process.cwd(), packageRoot: PKG_ROOT });
      const result = uninstall({ scope: scoped.scope, cwd: process.cwd(), packageRoot: PKG_ROOT });
      let totalRemoved = 0;
      for (const [agent, x] of Object.entries(result)) {
        const label = agent === 'claude' ? 'Claude Code' : 'Copilot CLI';
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

async function cmdStatus() {
  const { status } = require(path.join(PKG_ROOT, 'lib', 'lifecycle.js'));
  const { installedScopes } = require(path.join(PKG_ROOT, 'lib', 'install-hooks.js'));
  const s = await status();
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

async function cmdInstallHooks(argv) {
  const flags = parseFlags(argv, {
    booleans: ['user', 'project', 'local', 'check'],
    values: ['target'],
  });
  let scope = pickScopeFlag(flags);
  let target = pickTargetFlag(flags);
  const { install, audit, detectAgents, findProjectRoot } = require(path.join(PKG_ROOT, 'lib', 'install-hooks.js'));

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
    const { promptInstallParams } = require(path.join(PKG_ROOT, 'lib', 'prompt-install.js'));
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
    const result = audit({ target, scope, cwd: process.cwd(), packageRoot: PKG_ROOT, version: PKG_VERSION });
    let exitCode = 0;
    for (const [agent, a] of Object.entries(result)) {
      console.log(`${agent === 'claude' ? 'Claude Code' : 'Copilot CLI'}:`);
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

  const result = install({ target, scope, cwd: process.cwd(), packageRoot: PKG_ROOT, version: PKG_VERSION });
  for (const [agent, r] of Object.entries(result)) {
    const label = agent === 'claude' ? 'Claude Code' : 'Copilot CLI';
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
}

function cmdUninstallHooks(argv) {
  const flags = parseFlags(argv, {
    booleans: ['user', 'project', 'local'],
    values: ['target'],
  });
  const scope = pickScopeFlag(flags);
  const target = pickTargetFlag(flags);
  const { uninstall } = require(path.join(PKG_ROOT, 'lib', 'install-hooks.js'));
  const result = uninstall({ target, scope, cwd: process.cwd(), packageRoot: PKG_ROOT });
  let total = 0;
  for (const [agent, x] of Object.entries(result)) {
    const results = x.results || [];
    const label = agent === 'claude' ? 'Claude Code' : 'Copilot CLI';
    for (const r of results) {
      total += r.removed;
      if (r.removed > 0) console.log(`${label}: ${c.ok('✓')} removed ${r.removed} from ${c.dim(r.file)} (${r.scope})`);
      else if (r.exists) console.log(c.dim(`${label}:   nothing to remove in ${r.file} (${r.scope})`));
      else console.log(c.dim(`${label}:   ${r.file} does not exist (${r.scope})`));
    }
  }
  if (total === 0) console.log(c.dim('No agent-viz hooks found.'));
}

function cmdHook() {
  // Internal: forwarded by Claude Code via settings.json.
  const { runHook } = require(path.join(PKG_ROOT, 'lib', 'hook.js'));
  runHook();
}

// First-run welcome: npm 9+ silences install-script stdout by default
// (foreground-scripts=false), and an increasing share of users disable
// install scripts entirely (--ignore-scripts, pnpm 10+, Bun by default).
// So we don't ship a postinstall hook — onboarding is surfaced here on
// the first agent-viz invocation, persisted via a sentinel file in
// ~/.agent-viz/. Skipped for the internal `hook` subcommand (would
// pollute the event hot path) and for --version (often parsed by tooling).
function showFirstRunWelcomeIfNeeded(argv) {
  if (argv.includes('--version') || argv.includes('-v')) return;
  if (argv[0] === 'hook') return;
  const os = require('os');
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
  showFirstRunWelcomeIfNeeded(argv);
  // Top-level flags
  if (argv[0] === '--version' || argv[0] === '-v') {
    console.log(PKG_VERSION);
    return;
  }
  if (argv[0] === '--help' || argv[0] === '-h' || argv[0] === 'help') {
    help();
    return;
  }

  const cmd = argv[0] && !argv[0].startsWith('-') ? argv[0] : 'start';
  const rest = argv[0] && !argv[0].startsWith('-') ? argv.slice(1) : argv;

  switch (cmd) {
    case 'start':            return cmdStart(rest);
    case 'stop':             return cmdStop(rest);
    case 'status':           return cmdStatus();
    case 'install-hooks':    return cmdInstallHooks(rest);
    case 'uninstall-hooks':  return cmdUninstallHooks(rest);
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

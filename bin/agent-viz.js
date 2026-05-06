#!/usr/bin/env node
'use strict';
// agent-viz CLI dispatcher.
//
// Usage :
//   agent-viz [start] [--port N] [--foreground] [--no-install-hooks] [--open]
//   agent-viz stop
//   agent-viz status
//   agent-viz install-hooks   [--user|--project|--local]
//   agent-viz uninstall-hooks [--user|--project|--local]
//   agent-viz hook            (internal — invoked by Claude Code via settings.json)
//   agent-viz --help | --version

const path = require('path');
const fs = require('fs');

const PKG_ROOT = path.resolve(__dirname, '..');
let PKG_VERSION = '0.0.0';
try { PKG_VERSION = require(path.join(PKG_ROOT, 'package.json')).version || '0.0.0'; } catch {}

function help() {
  console.log(`agent-viz v${PKG_VERSION}

Usage:
  agent-viz [start]              Start the visualizer (default).
                                   --port N           listen on port N (default 3333)
                                   --foreground       attach to terminal (don't daemonize)
                                   --no-install-hooks don't auto-install hooks
                                   --open             open browser to the URL
  agent-viz stop                 Stop the running visualizer.
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
  const cmd = process.platform === 'darwin' ? 'open'
            : process.platform === 'win32' ? 'start'
            : 'xdg-open';
  try {
    spawn(cmd, [url], { stdio: 'ignore', detached: true }).unref();
  } catch {}
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
        console.log(`✓ ${label} hooks ${verb} → ${r.target.file}`);
        console.log(`  scope: ${r.target.scope}, mode: ${r.command.mode}`);
        if (r.missing && r.missing.length > 0) console.log(`  added on: ${r.missing.join(', ')}`);
        if (r.updated && r.updated.length > 0) console.log(`  refreshed on (was stale): ${r.updated.join(', ')}`);
        if (r.gitignore && r.gitignore.changed) {
          console.log(`  + .gitignore : added ${agent === 'claude' ? '.claude/settings.local.json' : '.github/hooks/agent-viz.local.json'}`);
        }
        printed = true;
      }
      if (printed) console.log('  → reopen /hooks in your agent (or restart) to reload settings.');
    } catch (e) {
      console.error(`! hook install skipped: ${e.message}`);
    }
  }

  const { start, status } = require(path.join(PKG_ROOT, 'lib', 'lifecycle.js'));
  try {
    const res = await start({ port, foreground: flags.foreground });
    if (res.foreground) {
      process.exit(res.exitCode || 0);
    }
    if (res.alreadyRunning) {
      console.log(`agent-viz already running → http://localhost:${res.port}  (pid ${res.pid})`);
    } else {
      console.log(`agent-viz started → http://localhost:${res.port}  (pid ${res.pid})`);
    }
    if (flags.open) openBrowser(`http://localhost:${res.port}`);
  } catch (e) {
    console.error(`✗ ${e.message}`);
    process.exit(1);
  }
}

async function cmdStop() {
  const { stop, status } = require(path.join(PKG_ROOT, 'lib', 'lifecycle.js'));
  const before = await status();
  if (!before.running) {
    console.log('agent-viz not running.');
    return;
  }
  const res = await stop();
  console.log(`agent-viz stopped (port ${res.port}${res.viaShutdown ? ', graceful' : ', forced'}).`);
}

async function cmdStatus() {
  const { status } = require(path.join(PKG_ROOT, 'lib', 'lifecycle.js'));
  const s = await status();
  if (s.running) {
    console.log(`running → http://localhost:${s.port}`);
    if (s.pid) console.log(`pid     : ${s.pid}`);
    if (s.startedAt) console.log(`started : ${s.startedAt}`);
    console.log(`log     : ${s.log}`);
  } else {
    console.log('not running.');
    if (s.stale) console.log(`(stale pid file cleared: pid ${s.stale.pid})`);
    console.log(`log     : ${s.log}`);
  }
}

function cmdInstallHooks(argv) {
  const flags = parseFlags(argv, {
    booleans: ['user', 'project', 'local', 'check'],
    values: ['target'],
  });
  const scope = pickScopeFlag(flags);
  const target = pickTargetFlag(flags);
  const { install, audit } = require(path.join(PKG_ROOT, 'lib', 'install-hooks.js'));

  if (flags.check) {
    const result = audit({ target, scope, cwd: process.cwd(), packageRoot: PKG_ROOT, version: PKG_VERSION });
    let exitCode = 0;
    for (const [agent, a] of Object.entries(result)) {
      console.log(`${agent === 'claude' ? 'Claude Code' : 'Copilot CLI'}:`);
      console.log(`  settings : ${a.file}  (scope: ${a.scope})`);
      for (const { event, installed, stale, others } of a.audit) {
        const flag = installed ? (stale ? '~' : 'x') : ' ';
        const tags = [];
        if (stale) tags.push('stale');
        if (others > 0) tags.push(`+${others} other`);
        console.log(`  [${flag}] ${event}${tags.length ? '   (' + tags.join(', ') + ')' : ''}`);
        if (!installed || stale) exitCode = 1;
      }
    }
    process.exit(exitCode);
  }

  const result = install({ target, scope, cwd: process.cwd(), packageRoot: PKG_ROOT, version: PKG_VERSION });
  for (const [agent, r] of Object.entries(result)) {
    const label = agent === 'claude' ? 'Claude Code' : 'Copilot CLI';
    console.log(`${label}:`);
    console.log(`  settings : ${r.target.file}  (scope: ${r.target.scope})`);
    console.log(`  hook cmd : ${r.command.command}  (mode: ${r.command.mode})`);
    if (r.action === 'noop') {
      console.log('  ✓ already installed and up to date.');
    } else {
      if (r.missing && r.missing.length > 0) console.log(`  ✓ added: ${r.missing.join(', ')}`);
      if (r.updated && r.updated.length > 0) console.log(`  ✓ refreshed (was stale): ${r.updated.join(', ')}`);
      if (r.present && r.present.length > 0) console.log(`  (already up to date: ${r.present.join(', ')})`);
    }
    const others = Object.entries(r.coexisting || {});
    if (others.length > 0) {
      console.log('  Coexisting hooks (run in parallel, untouched):');
      for (const [ev, n] of others) console.log(`    - ${ev}: ${n} other(s)`);
    }
    if (r.gitignore && r.gitignore.changed) {
      console.log(`  + .gitignore : added ${agent === 'claude' ? '.claude/settings.local.json' : '.github/hooks/agent-viz.local.json'}`);
    }
  }
  const anyChange = Object.values(result).some(r => r && r.action && r.action !== 'noop');
  if (anyChange) {
    console.log('\n→ Reopen /hooks in your agent (or restart) to reload settings.');
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
  const result = uninstall({ target, scope, cwd: process.cwd() });
  let total = 0;
  for (const [agent, x] of Object.entries(result)) {
    const results = x.results || [];
    const label = agent === 'claude' ? 'Claude Code' : 'Copilot CLI';
    for (const r of results) {
      total += r.removed;
      if (r.removed > 0) console.log(`${label}: ✓ removed ${r.removed} from ${r.file} (${r.scope})`);
      else if (r.exists) console.log(`${label}:   nothing to remove in ${r.file} (${r.scope})`);
      else console.log(`${label}:   ${r.file} does not exist (${r.scope})`);
    }
  }
  if (total === 0) console.log('No agent-viz hooks found.');
}

function cmdHook() {
  // Internal: forwarded by Claude Code via settings.json.
  const { runHook } = require(path.join(PKG_ROOT, 'lib', 'hook.js'));
  runHook();
}

async function main() {
  const argv = process.argv.slice(2);
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
    case 'stop':             return cmdStop();
    case 'status':           return cmdStatus();
    case 'install-hooks':    return cmdInstallHooks(rest);
    case 'uninstall-hooks':  return cmdUninstallHooks(rest);
    case 'hook':             return cmdHook();
    default:
      console.error(`Unknown command: ${cmd}\n`);
      help();
      process.exit(2);
  }
}

main().catch(e => {
  console.error(`✗ ${e.stack || e.message}`);
  process.exit(1);
});

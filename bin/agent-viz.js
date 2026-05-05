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
                                   --no-install-hooks don't auto-install Claude Code hooks
                                   --open             open browser to the URL
  agent-viz stop                 Stop the running visualizer.
  agent-viz status               Show running state + URL.
  agent-viz install-hooks        Install Claude Code hooks. Scope flags:
                                   --user             ~/.claude/settings.json
                                   --project          <root>/.claude/settings.json
                                   --local            <root>/.claude/settings.local.json (default in project)
  agent-viz uninstall-hooks      Remove Claude Code hooks (all scopes if no flag).
  agent-viz hook                 Internal — read JSON event from stdin.
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
      if (result.action === 'installed') {
        console.log(`✓ Hooks installed → ${result.target.file}`);
        console.log(`  scope: ${result.target.scope}, mode: ${result.command.mode}`);
        console.log(`  events: ${result.missing.join(', ')}`);
        if (result.gitignore && result.gitignore.changed) {
          console.log('  + .gitignore : added .claude/settings.local.json');
        }
        console.log('  → reopen /hooks in Claude Code (or restart) to reload settings.');
      }
      // else noop — silent
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
  const flags = parseFlags(argv, { booleans: ['user', 'project', 'local', 'check'] });
  const scope = pickScopeFlag(flags);
  const { install, audit } = require(path.join(PKG_ROOT, 'lib', 'install-hooks.js'));

  if (flags.check) {
    const a = audit({ scope, cwd: process.cwd() });
    console.log(`settings : ${a.file}  (scope: ${a.scope})`);
    for (const { event, installed } of a.audit) {
      console.log(`  [${installed ? 'x' : ' '}] ${event}`);
    }
    const missing = a.audit.filter(x => !x.installed);
    process.exit(missing.length === 0 ? 0 : 1);
  }

  const result = install({ scope, cwd: process.cwd(), packageRoot: PKG_ROOT, version: PKG_VERSION });
  console.log(`settings : ${result.target.file}  (scope: ${result.target.scope})`);
  console.log(`hook cmd : ${result.command.command}  (mode: ${result.command.mode})`);
  if (result.action === 'noop') {
    console.log('✓ Already installed — nothing to do.');
    return;
  }
  console.log(`✓ Added: ${result.missing.join(', ')}`);
  if (result.present.length > 0) console.log(`  (already present: ${result.present.join(', ')})`);
  if (result.gitignore && result.gitignore.changed) {
    console.log('  + .gitignore : added .claude/settings.local.json');
  }
  console.log('\n→ Reopen /hooks in Claude Code (or restart) to reload settings.');
}

function cmdUninstallHooks(argv) {
  const flags = parseFlags(argv, { booleans: ['user', 'project', 'local'] });
  const scope = pickScopeFlag(flags);
  const { uninstall } = require(path.join(PKG_ROOT, 'lib', 'install-hooks.js'));
  const { results } = uninstall({ scope, cwd: process.cwd() });
  let total = 0;
  for (const r of results) {
    total += r.removed;
    if (r.removed > 0) console.log(`✓ removed ${r.removed} from ${r.file} (${r.scope})`);
    else if (r.exists) console.log(`  nothing to remove in ${r.file} (${r.scope})`);
    else console.log(`  ${r.file} does not exist (${r.scope})`);
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

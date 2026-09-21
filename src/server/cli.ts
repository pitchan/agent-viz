import path from 'node:path';
import { spawn } from 'node:child_process';
import { styleText } from 'node:util';
import { pathToFileURL } from 'node:url';

// Copie volontaire de la même table dans bin/agent-viz.ts : ce module vit dans
// dist/, le shim ne peut rien lui importer avant d'avoir confirmé que dist/
// existe — même raison que packageRoot, reçu en paramètre plutôt qu'importé.
const c = {
  ok:   (s: string) => styleText('green',  s),
  hint: (s: string) => styleText('cyan',   s),
  dim:  (s: string) => styleText('gray',   s),
  warn: (s: string) => styleText('yellow', s),
  err:  (s: string) => styleText('red',    s),
};

function pickScopeFlag(flags: Record<string, unknown>) {
  if (flags.user) return 'user';
  if (flags.project) return 'project';
  if (flags.local) return 'local';
  return undefined;
}

function openBrowser(url: string) {
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
function requestedPort(flags: Record<string, unknown>) {
  const valeur = (flags.port as string | undefined) || process.env.PORT;
  return valeur ? parseInt(valeur, 10) : undefined;
}

export async function cmdStart(flags: Record<string, any>, packageRoot: string) {
  const port = requestedPort(flags);
  // Default install-hooks=true unless --no-install-hooks given.
  const shouldInstall = flags['install-hooks'] !== false;

  if (shouldInstall) {
    const { install } = await import(pathToFileURL(path.join(packageRoot, 'dist', 'server', 'install-hooks.js')).href);
    try {
      const result = install({ cwd: process.cwd(), packageRoot });
      let printed = false;
      for (const [agent, r] of Object.entries(result) as [string, any][]) {
        if (!r) continue;
        const label = agent === 'claude' ? 'Claude Code' : 'Copilot CLI';
        if (r.error) {
          // Un refus ne vaut que pour son agent : le message le nomme, plutôt qu'un
          // « skipped » qui vaudrait pour tous.
          console.error(`${c.warn('!')} ${label} hooks not installed: ${r.error}`);
          continue;
        }
        if (r.action === 'noop') continue;
        const verb = r.action === 'updated' ? 'refreshed'
                   : r.action === 'installed+updated' ? 'installed + refreshed'
                   : 'installed';
        console.log(`${c.ok('✓')} ${label} hooks ${verb} ${c.hint('→')} ${c.dim(r.target.file)}`);
        console.log(c.dim(`  scope: ${r.target.scope}, mode: ${r.command.mode}`));
        if (r.backup) console.log(c.dim(`  backup: ${r.backup}`));
        if (r.missing && r.missing.length > 0) console.log(`  added on: ${r.missing.join(', ')}`);
        if (r.updated && r.updated.length > 0) console.log(`  refreshed on (was stale): ${r.updated.join(', ')}`);
        if (r.gitignore && r.gitignore.changed) {
          console.log(`  + .gitignore : added ${agent === 'claude' ? '.claude/settings.local.json' : '.github/hooks/agent-viz.local.json'}`);
        }
        printed = true;
      }
      if (printed) console.log(`  ${c.hint('→')} reopen /hooks in your agent (or restart) to reload settings.`);
    } catch (e: any) {
      console.error(`${c.warn('!')} hook install skipped: ${e.message}`);
    }
  }

  const { start } = await import(pathToFileURL(path.join(packageRoot, 'dist', 'server', 'lifecycle.js')).href);
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
  } catch (e: any) {
    console.error(`${c.err('✗')} ${e.message}`);
    process.exit(1);
  }
}

export async function cmdStop(flags: Record<string, any>, packageRoot: string) {
  const { stop, status } = await import(pathToFileURL(path.join(packageRoot, 'dist', 'server', 'lifecycle.js')).href);
  const port = requestedPort(flags);
  const before = await status({ port });
  let res: any = null;
  if (before.running) {
    res = await stop({ port });
  } else {
    console.log('agent-viz not running.');
  }

  // Mirror of cmdStart's auto-install: stop also removes hooks unless opted out.
  // We target the SAME scope `start` would have resolved from this cwd
  // (`resolveScope` returns 'user' when no scope is given, project root or not),
  // so unrelated installs in other scopes are preserved. Sweeps both agents —
  // uninstalling an agent that was never installed is a no-op.
  const shouldUninstall = flags['keep-hooks'] !== true;
  if (shouldUninstall) {
    const { uninstall, resolveScope } = await import(pathToFileURL(path.join(packageRoot, 'dist', 'server', 'install-hooks.js')).href);
    try {
      const scoped = resolveScope({ cwd: process.cwd(), packageRoot });
      const result = uninstall({ scope: scoped.scope, cwd: process.cwd(), packageRoot });
      let totalRemoved = 0;
      for (const [agent, x] of Object.entries(result) as [string, any][]) {
        const label = agent === 'claude' ? 'Claude Code' : 'Copilot CLI';
        if (x.error) {
          // Un refus s'imprime toujours : tu, il laisserait des hooks posés qui tirent
          // à l'insu de l'utilisateur. Il ne touche pas le code de sortie, qui dit le cycle
          // de vie du serveur ; install-hooks et uninstall-hooks, eux, sortent 1 sur un refus.
          console.log(`${c.err('✗')} ${label} hooks NOT removed: ${x.error}`);
          continue;
        }
        for (const r of (x.results || [])) {
          if (r.removed > 0) {
            totalRemoved += r.removed;
            console.log(`${c.ok('✓')} ${label} hooks removed ${c.hint('→')} ${c.dim(r.file)} (${r.scope})`);
            if (r.backup) console.log(c.dim(`  backup: ${r.backup}`));
          }
        }
      }
      if (totalRemoved > 0) {
        console.log(c.dim('  (use `agent-viz stop --keep-hooks` to preserve hooks next time)'));
      }
    } catch (e: any) {
      console.error(`${c.warn('!')} hook uninstall skipped: ${e.message}`);
    }
  }

  if (res) {
    if (res.stopped) {
      console.log(`${c.ok('✓')} agent-viz stopped ${c.dim(`(port ${res.port}).`)}`);
    } else if (res.why === 'nothing-listening') {
      console.log(`agent-viz not running ${c.dim(`(port ${res.port} does not answer).`)}`);
    } else {
      console.error(`${c.err('✗')} port ${res.port} still answers after POST /shutdown. Nothing was killed.`);
      console.error(`  Either it is not agent-viz, or the daemon did not exit. Find the process listening on port ${res.port} and stop it yourself:`);
      console.error(`  Windows     : netstat -ano | findstr :${res.port}   then   taskkill /PID <pid> /F`);
      console.error(`  macOS/Linux : lsof -iTCP:${res.port} -sTCP:LISTEN   then   kill <pid>`);
      process.exitCode = 1;
    }
  }
}

export async function cmdStatus(flags: Record<string, any>, packageRoot: string) {
  const { status } = await import(pathToFileURL(path.join(packageRoot, 'dist', 'server', 'lifecycle.js')).href);
  const { installedScopes } = await import(pathToFileURL(path.join(packageRoot, 'dist', 'server', 'install-hooks.js')).href);
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

  const scopes = installedScopes({ cwd: process.cwd(), packageRoot });
  const lines: string[] = [];
  for (const [agent, scan] of Object.entries(scopes) as [string, any][]) {
    if (!scan) continue;
    const label = agent === 'claude' ? 'Claude Code' : 'Copilot CLI';
    const list = scan.installed;
    if (list.length > 0) {
      const names = list.map((x: any) => x.scope).join(', ');
      const dup = list.length > 1 ? c.warn(`  ! duplicate: each event fires ${list.length}x`) : '';
      lines.push(`  ${label.padEnd(11)} : ${names}${dup}`);
    }
    // Un fichier illisible n'est pas une portée sans hook : sans cette ligne,
    // `status` afficherait la même chose qu'un fichier sain et laisserait
    // croire que la portée n'est pas installée.
    for (const u of scan.unreadable) {
      lines.push(`  ${label.padEnd(11)} : ${c.warn(`! ${u.scope} unreadable — ${u.error}`)}`);
    }
  }
  if (lines.length > 0) {
    console.log('hooks   :');
    for (const l of lines) console.log(l);
  }
}

export async function cmdInstallHooks(flags: Record<string, any>, packageRoot: string) {
  let scope = pickScopeFlag(flags);
  let target = flags.target;
  const { install, audit, detectAgents, findProjectRoot } = await import(pathToFileURL(path.join(packageRoot, 'dist', 'server', 'install-hooks.js')).href);

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
    const { promptInstallParams } = await import(pathToFileURL(path.join(packageRoot, 'dist', 'server', 'prompt-install.js')).href);
    const detected = detectAgents();
    const projectRoot = findProjectRoot(process.cwd(), { packageRoot });
    try {
      ({ target, scope } = await promptInstallParams({
        detected,
        projectRoot,
        io: { input: process.stdin, output: process.stdout },
      }));
    } catch (e: any) {
      if (e.message === 'aborted') process.exit(130);
      throw e;
    }
  }

  if (flags.check) {
    const result = audit({ target, scope, cwd: process.cwd(), packageRoot });
    let exitCode = 0;
    for (const [agent, a] of Object.entries(result) as [string, any][]) {
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

  const result = install({ target, scope, cwd: process.cwd(), packageRoot });
  let refused = false;
  for (const [agent, r] of Object.entries(result) as [string, any][]) {
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
    if (r.backup) console.log(c.dim(`  backup   : ${r.backup}`));
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
      const othersScope = r.crossScope.map((s: any) => s.scope).join(', ');
      console.log(`  ${c.warn('!')} hooks also installed in: ${othersScope}`);
      console.log(c.dim(`    each event will fire ${1 + r.crossScope.length}x (one per scope) — uninstall the extras with`));
      for (const s of r.crossScope) {
        console.log(c.dim(`      agent-viz uninstall-hooks --${s.scope} --target=${agent}`));
      }
    }
  }
  const anyChange = Object.values(result).some((r: any) => r && r.action && r.action !== 'noop');
  if (anyChange) {
    console.log(`\n${c.hint('→')} Reopen /hooks in your agent (or restart) to reload settings.`);
    console.log(`  To uninstall later: run \`${c.ok('agent-viz uninstall-hooks')}\` BEFORE \`npm uninstall\``);
    console.log(c.dim('  (npm 7+ does not run lifecycle scripts on uninstall — manual cleanup required).'));
  }
  if (refused) process.exitCode = 1;
}

export async function cmdUninstallHooks(flags: Record<string, any>, packageRoot: string) {
  const scope = pickScopeFlag(flags);
  const target = flags.target;
  const { uninstall } = await import(pathToFileURL(path.join(packageRoot, 'dist', 'server', 'install-hooks.js')).href);
  const result = uninstall({ target, scope, cwd: process.cwd(), packageRoot });
  let total = 0;
  let failed = false;
  for (const [agent, x] of Object.entries(result) as [string, any][]) {
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
      if (r.backup) console.log(c.dim(`${label}:   backup: ${r.backup}`));
    }
  }
  // Une erreur ne doit jamais se lire comme « rien à retirer » : le total reste
  // à 0 quand un agent n'a pas pu être traité du tout.
  if (total === 0 && !failed) console.log(c.dim('No agent-viz hooks found.'));
  // …ni comme un succès pour le script appelant : sortir 0 en annonçant « hooks NOT
  // removed » ferait lire un succès à une étape de CI alors que les hooks restent posés.
  if (failed) process.exitCode = 1;
}

export async function cmdHook(packageRoot: string) {
  const { runHook } = await import(pathToFileURL(path.join(packageRoot, 'dist', 'server', 'hook.js')).href);
  runHook();
}

'use strict';
// PID file + start/stop/status helpers for agent-viz.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawn } from 'node:child_process';

const PID_FILE = path.join(os.tmpdir(), 'agent-viz.pid');
const LOG_FILE = path.join(os.tmpdir(), 'agent-viz.log');
const SERVER_SCRIPT = path.join(import.meta.dirname, 'server.js');
// Le retrait des types avertit une fois par processus, au premier `.ts`
// servi : avalé en tâche de fond (stdio vers le fichier de log), visible en
// avant-plan sans ce drapeau.
const NODE_FLAGS = ['--disable-warning=ExperimentalWarning'];
// Seule valeur par défaut du port : le binaire transmet un port indéfini quand
// ni --port ni PORT ne sont donnés.
const DEFAULT_PORT = 3333;

interface PidRecord {
  pid: number;
  port: number;
  startedAt: string;
}

function readPidFile(): PidRecord | null {
  try {
    const raw = fs.readFileSync(PID_FILE, 'utf8');
    const [pidStr, portStr, startedAt] = raw.split('\n');
    // `noUncheckedIndexedAccess` : un `split('\n')` ne garantit pas trois
    // éléments — `?? ''` rend `parseInt('', 10)`, soit NaN, que la garde
    // `!pid || !port` ci-dessous refuse.
    const pid = parseInt(pidStr ?? '', 10);
    const port = parseInt(portStr ?? '', 10);
    if (!pid || !port) return null;
    return { pid, port, startedAt: startedAt || '' };
  } catch { return null; }
}

function writePidFile(pid: number, port: number): void {
  fs.writeFileSync(PID_FILE, `${pid}\n${port}\n${new Date().toISOString()}\n`);
}

function removePidFile(): void {
  try { fs.unlinkSync(PID_FILE); } catch {}
}

function isPidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (e: unknown) { return e instanceof Error && 'code' in e && e.code === 'EPERM'; }
}

// Quick HTTP GET / probe. Returns true if server responds within timeout ms.
function probe(port: number, timeout: number = 500): Promise<boolean> {
  return new Promise<boolean>(resolve => {
    const req = http.request({ hostname: '127.0.0.1', port, path: '/', method: 'GET', timeout }, res => {
      res.resume();
      res.on('end', () => resolve(true));
      res.on('error', () => resolve(false));
      // Some responses end immediately; resolve on close too.
      res.on('close', () => resolve(true));
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end();
  });
}

async function postShutdown(port: number, timeout: number = 2000): Promise<boolean> {
  return new Promise<boolean>(resolve => {
    const req = http.request({ hostname: '127.0.0.1', port, path: '/shutdown', method: 'POST', timeout }, res => {
      res.resume();
      res.on('end', () => resolve(true));
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end();
  });
}

interface PortOptions {
  port?: number;
}

async function status({ port = DEFAULT_PORT }: PortOptions = {}) {
  const rec = readPidFile();
  if (!rec) {
    // Maybe a server is running but without our PID file (e.g. started manually).
    if (await probe(port, 200)) return { running: true, pid: null, port, startedAt: null, log: LOG_FILE, viaPidFile: false };
    return { running: false, log: LOG_FILE };
  }
  const alive = isPidAlive(rec.pid);
  const responsive = await probe(rec.port, 200);
  if (alive && responsive) {
    return { running: true, ...rec, log: LOG_FILE, viaPidFile: true };
  }
  // Stale PID file.
  removePidFile();
  return { running: false, log: LOG_FILE, stale: rec };
}

// Spawn the server detached. Returns the PID.
async function spawnDetached(port: number): Promise<number> {
  // Truncate log file at each start.
  try { fs.writeFileSync(LOG_FILE, ''); } catch {}
  const out = fs.openSync(LOG_FILE, 'a');
  const err = fs.openSync(LOG_FILE, 'a');
  const env = { ...process.env, PORT: String(port) };
  try {
    const child = spawn(process.execPath, [...NODE_FLAGS, SERVER_SCRIPT], {
      detached: true,
      stdio: ['ignore', out, err],
      env,
    });
    child.unref();
    // `spawn(process.execPath, …)` lance le binaire Node courant, qui existe
    // forcément : `pid` n'est `undefined` que sur un échec synchrone de spawn
    // (exécutable introuvable), qui ne peut pas se produire ici. Le cast reflète
    // cet invariant plutôt que de propager `number | undefined` aux appelants.
    return child.pid as number;
  } finally {
    // Le fils garde ses propres copies des descripteurs du journal. Ceux du
    // parent ne servent plus, et sous Windows ils bloquent le dossier du journal.
    fs.closeSync(out);
    fs.closeSync(err);
  }
}

// Run the server attached to current process (foreground mode). Inherits stdio.
function spawnForeground(port: number): Promise<number> {
  const env = { ...process.env, PORT: String(port) };
  const child = spawn(process.execPath, [...NODE_FLAGS, SERVER_SCRIPT], {
    stdio: 'inherit',
    env,
  });
  // Forward signals so Ctrl+C kills the server cleanly.
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => { try { child.kill(sig); } catch {} });
  }
  return new Promise<number>(resolve => {
    child.on('exit', code => resolve(code || 0));
  });
}

interface StartOptions extends PortOptions {
  foreground?: boolean;
}

// Idempotent start. Resolves with { alreadyRunning, pid, port }.
async function start({ port = DEFAULT_PORT, foreground = false }: StartOptions = {}) {
  // 1. Check existing instance via PID file.
  const existing = await status({ port });
  if (existing.running) {
    if (foreground) {
      // User wants foreground but something is already on the port.
      throw new Error(`agent-viz already running on port ${existing.port} (pid ${existing.pid || '?'}). Run "agent-viz stop" first.`);
    }
    return { alreadyRunning: true, pid: existing.pid, port: existing.port };
  }

  if (foreground) {
    // Run in this process. Does not return until the server exits.
    const code = await spawnForeground(port);
    return { foreground: true, exitCode: code, port };
  }

  const pid = await spawnDetached(port);
  // Poll for readiness up to 3 s.
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (await probe(port, 200)) {
      writePidFile(pid, port);
      return { alreadyRunning: false, pid, port };
    }
    if (!isPidAlive(pid)) break;
    await new Promise(r => setTimeout(r, 100));
  }
  // Boot failed — try to read log tail for the error message.
  let tail = '';
  try {
    const logContent = fs.readFileSync(LOG_FILE, 'utf8');
    tail = logContent.split('\n').slice(-20).join('\n');
  } catch {}
  const why = isPidAlive(pid) ? 'did not answer within 3s' : 'exited during startup';
  throw new Error(`agent-viz ${why} (pid ${pid}, port ${port}).\nLog tail:\n${tail}`);
}

type StopResult =
  | { stopped: true; port: number }
  | { stopped: false; port: number; why: 'nothing-listening' | 'still-answering' };

// stop ne signale jamais un pid : le démon ne retire pas son fichier de pid en
// mourant et Windows réattribue un pid en quelques secondes, donc le pid du
// fichier peut désigner n'importe quel processus. La preuve d'arrêt est le port.
async function stop({ port = DEFAULT_PORT }: PortOptions = {}): Promise<StopResult> {
  const rec = readPidFile();
  // Le fichier de pid dit où le démon écoute réellement : il l'emporte sur le
  // port demandé.
  const cible = rec ? rec.port : port;
  if (!(await probe(cible, 200))) {
    removePidFile();
    return { stopped: false, port: cible, why: 'nothing-listening' };
  }
  // La réponse au POST ne prouve rien (un serveur étranger répond 200 aussi) :
  // seul le port qui se tait compte.
  await postShutdown(cible, 2000);
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    if (!(await probe(cible, 200))) {
      removePidFile();
      return { stopped: true, port: cible };
    }
    await new Promise(r => setTimeout(r, 100));
  }
  // Rien n'a été arrêté : le fichier de pid reste tel quel.
  return { stopped: false, port: cible, why: 'still-answering' };
}

export {
  DEFAULT_PORT,
  PID_FILE,
  LOG_FILE,
  status,
  start,
  stop,
  readPidFile,
  writePidFile,
  removePidFile,
  isPidAlive,
  probe,
};

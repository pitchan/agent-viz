'use strict';
// Verrou d'un fichier de session : le hook y ajoute des lignes, le ménage le réécrit en entier.
// Une réécriture traversée par un ajout perd la ligne ajoutée. Le verrou est un fichier voisin
// créé en mode exclusif ('wx'), atomique sous Windows comme sous POSIX, qui porte son détenteur.

import fs from 'node:fs';
import { randomUUID } from 'node:crypto';

// Un verrou se rend en le renommant, jamais en le supprimant sur place : sous Windows, un nom en
// cours de suppression refuse toute ouverture par EPERM, et serait pris pour un refus de droits.
const WAIT_MS = 3000;
const POLL_MS = 5;
// Un verrou vide est celui d'un détenteur mort entre la création et l'écriture de son nom.
const EMPTY_STALE_MS = 2000;

class SessionLockError extends Error {}

function lockPath(file: string): string {
  return `${file}.lock`;
}

function errorCode(err: unknown): unknown {
  return err instanceof Error && 'code' in err ? err.code : undefined;
}

// Le contenu du verrou, ou null s'il a disparu entre-temps.
function readHolder(lock: string): string | null {
  try { return fs.readFileSync(lock, 'utf8'); } catch (err: unknown) {
    if (errorCode(err) === 'ENOENT') return null;
    throw err;
  }
}

function processAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (err: unknown) {
    return errorCode(err) === 'EPERM';
  }
}

function abandoned(lock: string, holder: string): boolean {
  const pid = parseInt(holder, 10);
  if (Number.isInteger(pid) && pid > 0) return !processAlive(pid);
  try { return Date.now() - fs.statSync(lock).mtimeMs > EMPTY_STALE_MS; } catch (err: unknown) {
    if (errorCode(err) === 'ENOENT') return false;
    throw err;
  }
}

// Le renommage vers un nom unique n'aboutit que pour un seul processus : deux preneurs ne
// suppriment pas ensemble le même verrou abandonné.
function discard(lock: string): void {
  const moved = `${lock}.${randomUUID()}`;
  try { fs.renameSync(lock, moved); } catch (err: unknown) {
    if (errorCode(err) === 'ENOENT') return;
    throw err;
  }
  fs.unlinkSync(moved);
}

function tryLock(file: string, token: string): boolean {
  const lock = lockPath(file);
  try {
    fs.writeFileSync(lock, token, { flag: 'wx' });
    return true;
  } catch (err: unknown) {
    if (errorCode(err) !== 'EEXIST') throw err;
  }
  const holder = readHolder(lock);
  if (holder !== null && abandoned(lock, holder) && readHolder(lock) === holder) discard(lock);
  return false;
}

// Rend le verrou s'il est encore le sien : un verrou disparu (session supprimée) ou repris par
// un autre n'est pas à supprimer, et ce n'est pas une erreur.
function unlock(file: string, token: string): void {
  if (readHolder(lockPath(file)) === token) discard(lockPath(file));
}

function newToken(): string {
  return `${process.pid} ${randomUUID()}`;
}

// Une panne du verrou se nomme comme telle : l'appelant la distingue d'une panne de son travail.
function asLockError<T>(file: string, step: () => T): T {
  try { return step(); } catch (err: unknown) {
    if (err instanceof SessionLockError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new SessionLockError(`session lock failed on ${lockPath(file)}: ${message}`, { cause: err });
  }
}

function timeout(file: string): SessionLockError {
  return new SessionLockError(`session lock not acquired within ${WAIT_MS} ms: ${lockPath(file)}`);
}

// Le hook est synchrone de bout en bout : il attend sans boucle d'événements.
function withSessionLockSync<T>(file: string, fn: () => T): T {
  const token = newToken();
  const pause = new Int32Array(new SharedArrayBuffer(4));
  const deadline = Date.now() + WAIT_MS;
  while (!asLockError(file, () => tryLock(file, token))) {
    if (Date.now() > deadline) throw timeout(file);
    Atomics.wait(pause, 0, 0, POLL_MS);
  }
  try { return fn(); } finally { asLockError(file, () => unlock(file, token)); }
}

async function withSessionLock<T>(file: string, fn: () => Promise<T>): Promise<T> {
  const token = newToken();
  const deadline = Date.now() + WAIT_MS;
  while (!asLockError(file, () => tryLock(file, token))) {
    if (Date.now() > deadline) throw timeout(file);
    await new Promise(resolve => setTimeout(resolve, POLL_MS));
  }
  try { return await fn(); } finally { asLockError(file, () => unlock(file, token)); }
}

export { SessionLockError, lockPath, withSessionLock, withSessionLockSync };

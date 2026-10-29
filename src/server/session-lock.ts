'use strict';
// Verrou d'un fichier de session : le hook y ajoute des lignes, le ménage le réécrit en entier.
// Une réécriture traversée par un ajout perd la ligne ajoutée. Le verrou est un fichier voisin
// créé en mode exclusif ('wx'), atomique sous Windows comme sous POSIX.

import fs from 'node:fs';

// Un verrou plus vieux appartient à un processus mort : la compaction la plus lente mesurée
// (200 Mo) tient en 250 ms, un ajout en quelques millisecondes. Au-delà de WAIT_MS sans verrou,
// le dossier refuse l'écriture pour une autre raison, et l'appelant reçoit l'erreur.
const STALE_MS = 2000;
const WAIT_MS = 3000;
const POLL_MS = 5;

function lockPath(file: string): string {
  return `${file}.lock`;
}

function errorCode(err: unknown): unknown {
  return err instanceof Error && 'code' in err ? err.code : undefined;
}

// Sous Windows, un verrou en cours de suppression refuse l'ouverture et le stat par EPERM
// au lieu de EEXIST : c'est un verrou occupé, qui sera libre au prochain essai.
function tryLock(file: string): boolean {
  try {
    fs.closeSync(fs.openSync(lockPath(file), 'wx'));
    return true;
  } catch (err: unknown) {
    const code = errorCode(err);
    if (code !== 'EEXIST' && code !== 'EPERM') throw err;
  }
  try {
    if (Date.now() - fs.statSync(lockPath(file)).mtimeMs > STALE_MS) fs.unlinkSync(lockPath(file));
  } catch (err: unknown) {
    const code = errorCode(err);
    if (code !== 'ENOENT' && code !== 'EPERM') throw err;
  }
  return false;
}

function unlock(file: string): void {
  fs.unlinkSync(lockPath(file));
}

function timeout(file: string): Error {
  return new Error(`session lock not acquired within ${WAIT_MS} ms: ${lockPath(file)}`);
}

// Le hook est synchrone de bout en bout : il attend sans boucle d'événements.
function withSessionLockSync<T>(file: string, fn: () => T): T {
  const pause = new Int32Array(new SharedArrayBuffer(4));
  const deadline = Date.now() + WAIT_MS;
  while (!tryLock(file)) {
    if (Date.now() > deadline) throw timeout(file);
    Atomics.wait(pause, 0, 0, POLL_MS);
  }
  try { return fn(); } finally { unlock(file); }
}

async function withSessionLock<T>(file: string, fn: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + WAIT_MS;
  while (!tryLock(file)) {
    if (Date.now() > deadline) throw timeout(file);
    await new Promise(resolve => setTimeout(resolve, POLL_MS));
  }
  try { return await fn(); } finally { unlock(file); }
}

export { withSessionLock, withSessionLockSync };

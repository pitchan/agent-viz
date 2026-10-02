// La reconstruction manuelle de la liste des sessions (`/sessions?rescan`) : elle rattrape le
// disque sans jamais vider la liste, donc sans perdre l'état d'une session qui écrit pendant ce temps.

import { afterAll, afterEach, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Redirige AVANT le premier import de `src/server/**` : session-index crée
// `os.tmpdir()/agent-events` dès son chargement, le vrai dossier d'événements.
const BAC = fs.mkdtempSync(path.join(os.tmpdir(), 'avtest-rescan-'));
process.env.TEMP = BAC;
process.env.TMP = BAC;
process.env.TMPDIR = BAC;

const { DIR, sessionIndex } = await import('../../src/server/session-index.ts');
const { unwatchSession } = await import('../../src/server/event-reader.ts');
const { rescanSessions } = await import('../../src/server/housekeep.ts');

afterEach(() => {
  for (const f of fs.readdirSync(DIR)) {
    unwatchSession(path.join(DIR, f));
    fs.rmSync(path.join(DIR, f), { force: true });
  }
  sessionIndex.clear();
});
afterAll(() => { fs.rmSync(BAC, { recursive: true, force: true }); });

const ligne = (i: number) => JSON.stringify({
  hook_event_name: 'PreToolUse', session_id: 's', tool_name: 'Bash', tool_use_id: `t${i}`, _source: 'copilot',
});

// Fichiers datés d'il y a longtemps : hors de la fenêtre de suivi, aucun watcher ne s'ouvre.
function fichier(nom: string, lignes: number): string {
  const fp = path.join(DIR, `${nom}.jsonl`);
  fs.writeFileSync(fp, Array.from({ length: lignes }, (_, i) => ligne(i)).join('\n') + '\n');
  const ancien = new Date('2020-01-01T00:00:00Z');
  fs.utimesSync(fp, ancien, ancien);
  return fp;
}

function connue(nom: string, eventCount: number) {
  const rec = {
    id: nom, promptCache: 'titre déjà lu', promptWindow: 0, eventCount, size: 10, mtime: 1, agentSource: 'copilot',
  };
  sessionIndex.set(nom, rec);
  return rec;
}

test('bac à sable : le dossier d\'événements est celui du test', () => {
  expect(DIR.startsWith(BAC), `dossier d'événements hors du bac : ${DIR}`).toBeTruthy();
});

test('une session déjà connue garde son enregistrement, avec ce qu\'il portait', async () => {
  // Arrange
  fichier('connue', 3);
  const avant = connue('connue', 3);
  // Act
  await rescanSessions();
  // Assert
  expect(sessionIndex.get('connue')).toBe(avant);
  expect(avant.promptCache).toBe('titre déjà lu');
});

test('un fichier que la liste ignorait y entre avec son nombre d\'événements', async () => {
  // Arrange
  fichier('nouvelle', 4);
  // Act
  await rescanSessions();
  // Assert
  expect(sessionIndex.get('nouvelle')?.eventCount).toBe(4);
});

test('une session dont le fichier a disparu du disque sort de la liste', async () => {
  // Arrange
  connue('disparue', 7);
  // Act
  await rescanSessions();
  // Assert
  expect(sessionIndex.has('disparue')).toBe(false);
});

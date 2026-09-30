// Ou le lecteur d'evenements commence a lire un fichier qu'il se met a suivre.
// Une session neuve est deja ecrite quand son watcher s'arme : la premiere
// ligne precede toujours l'evenement de dossier qui l'annonce.

import { afterAll, afterEach, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SseClient } from '../../src/server/sse.ts';
import type { SessionRecord } from '../../src/server/session-index.ts';

// Redirige AVANT le premier import de `src/server/**` : session-index cree
// `os.tmpdir()/agent-events` des son chargement, le vrai dossier d'evenements.
const BAC = fs.mkdtempSync(path.join(os.tmpdir(), 'avtest-session-neuve-'));
process.env.TEMP = BAC;
process.env.TMP = BAC;
process.env.TMPDIR = BAC;

const { sseClients } = await import('../../src/server/sse.ts');
const { DIR, sessionIndex } = await import('../../src/server/session-index.ts');
const {
  readAndBroadcast, watchSession, unwatchSession, liveHandoffOffset,
} = await import('../../src/server/event-reader.ts');

const suivis: string[] = [];
const auditeurs: SseClient[] = [];
afterEach(() => {
  for (const fp of suivis.splice(0)) unwatchSession(fp);
  for (const c of auditeurs.splice(0)) sseClients.delete(c);
});
afterAll(() => { fs.rmSync(BAC, { recursive: true, force: true }); });

test('bac a sable: le dossier d evenements est celui du test', () => {
  expect(DIR.startsWith(BAC), `dossier d evenements hors du bac : ${DIR}`).toBeTruthy();
});

const evenement = (i: number) => JSON.stringify({
  hook_event_name: 'PreToolUse', session_id: 's', tool_name: 'Bash', tool_use_id: `t${i}`,
});
const TROIS_LIGNES = [1, 2, 3].map(evenement).join('\n') + '\n';

// `agentSource: 'copilot'` et `promptCache: null` tiennent le lecteur de
// transcription et la sonde du premier prompt hors de ce qu'on mesure ici.
function session(nom: string, contenu: string, dejaCompte: { size: number; eventCount: number }) {
  const fp = path.join(DIR, `${nom}.jsonl`);
  fs.writeFileSync(fp, contenu);
  sessionIndex.set(nom, {
    id: nom, promptCache: null, promptWindow: 0, mtime: Date.now(), agentSource: 'copilot',
    ...dejaCompte,
  } as SessionRecord);
  suivis.push(fp);
  return fp;
}

function ecouterSSE() {
  const recus: any[] = [];
  const client: SseClient = { write: (msg: string) => { recus.push(JSON.parse(msg.slice('data: '.length))); } };
  sseClients.add(client);
  auditeurs.push(client);
  return recus;
}

test('une session neuve deja ecrite est lue et comptee depuis sa premiere ligne', async () => {
  // Arrange — la fiche vide est celle que pose le watcher du dossier.
  const fp = session('neuve', TROIS_LIGNES, { size: 0, eventCount: 0 });
  const recus = ecouterSSE();
  watchSession(fp);

  // Act
  await readAndBroadcast(fp);

  // Assert
  expect(sessionIndex.get('neuve')?.eventCount).toBe(3);
  expect(recus.filter(m => m.type === 'event').map(m => m.event.tool_use_id)).toEqual(['t1', 't2', 't3']);
});

test('une session deja comptee au demarrage n est pas rejouee sur le canevas', async () => {
  // Arrange
  const fp = session('au-demarrage', TROIS_LIGNES, { size: Buffer.byteLength(TROIS_LIGNES), eventCount: 3 });
  const recus = ecouterSSE();
  watchSession(fp);

  // Act
  await readAndBroadcast(fp);

  // Assert
  expect(sessionIndex.get('au-demarrage')?.eventCount).toBe(3);
  expect(recus.filter(m => m.type === 'event')).toEqual([]);
});

test('le rattrapage laisse au chemin vif toute une session neuve', () => {
  // Arrange
  const fp = session('neuve-rattrapage', TROIS_LIGNES, { size: 0, eventCount: 0 });

  // Act
  watchSession(fp);

  // Assert
  expect(liveHandoffOffset(fp)).toBe(0);
});

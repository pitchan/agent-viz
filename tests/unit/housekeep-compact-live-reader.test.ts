// La compaction réécrit un fichier de session pendant que le lecteur vif le suit
// et que le hook continue d'y écrire : chaque événement doit rester sur le disque
// et partir vers le tableau de bord une fois, ni perdu ni rejoué.

import { afterAll, afterEach, beforeEach, expect, test, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SseClient } from '../../src/server/sse.ts';
import type { SessionRecord } from '../../src/server/session-index.ts';

// Redirige AVANT le premier import de `src/server/**` : session-index calcule
// son dossier d'événements depuis os.tmpdir() à son chargement.
const BAC = fs.mkdtempSync(path.join(os.tmpdir(), 'avtest-compaction-vif-'));
process.env.TEMP = BAC;
process.env.TMP = BAC;
process.env.TMPDIR = BAC;

const { sseClients } = await import('../../src/server/sse.ts');
const { DIR, sessionIndex, COMPACT_KEEP_EVENTS } = await import('../../src/server/session-index.ts');
const { readAndBroadcast, resetFileOffset, unwatchSession } = await import('../../src/server/event-reader.ts');
const { compactSession } = await import('../../src/server/housekeep.ts');

const suivis: string[] = [];
const auditeurs: SseClient[] = [];
beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout'] }); });
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  for (const fp of suivis.splice(0)) unwatchSession(fp);
  for (const c of auditeurs.splice(0)) sseClients.delete(c);
});
afterAll(() => { fs.rmSync(BAC, { recursive: true, force: true }); });

test('bac a sable: le dossier d evenements est celui du test', () => {
  expect(DIR.startsWith(BAC), `dossier d evenements hors du bac : ${DIR}`).toBeTruthy();
});

const outil = (i: number) => JSON.stringify({
  hook_event_name: 'PreToolUse', session_id: 's', agent_id: 'a1', tool_name: 'Bash', tool_use_id: `t${i}`, _source: 'copilot',
}) + '\n';
const FIN_DU_SOUS_AGENT = JSON.stringify({
  hook_event_name: 'SubagentStop', session_id: 's', agent_id: 'a1', _source: 'copilot',
}) + '\n';

// Une session au-delà du seuil de lignes, entièrement lue par le chemin vif.
// `agentSource: 'copilot'` et `promptCache: null` tiennent la transcription et
// la sonde du premier prompt hors de ce qu'on mesure ici.
function sessionLue(nom: string) {
  const contenu = Array.from({ length: COMPACT_KEEP_EVENTS + 30 }, (_, i) => outil(i)).join('');
  const fp = path.join(DIR, `${nom}.jsonl`);
  fs.writeFileSync(fp, contenu);
  suivis.push(fp);
  const taille = Buffer.byteLength(contenu);
  sessionIndex.set(nom, {
    id: nom, promptCache: null, promptWindow: 0, mtime: Date.now(), agentSource: 'copilot',
    size: taille, eventCount: COMPACT_KEEP_EVENTS + 30,
  } as SessionRecord);
  resetFileOffset(fp, taille);
  return fp;
}

function ecouterSSE() {
  const recus: any[] = [];
  const client: SseClient = { write: (msg: string) => { recus.push(JSON.parse(msg.slice('data: '.length))); } };
  sseClients.add(client);
  auditeurs.push(client);
  return recus;
}

const finsRecues = (recus: any[]) =>
  recus.filter(m => m.type === 'event' && m.event.hook_event_name === 'SubagentStop').length;

// Le hook écrit juste après que la compaction a lu le fichier, avant qu'elle le réécrive.
function lectureSuivieDUneEcriture(fp: string) {
  return async (p: string) => {
    const contenu = await fs.promises.readFile(p, 'utf8');
    fs.appendFileSync(fp, FIN_DU_SOUS_AGENT);
    return contenu;
  };
}

test('un evenement deja diffuse n est pas rediffuse apres la compaction', async () => {
  // Arrange
  const fp = sessionLue('deja-diffuse');
  fs.appendFileSync(fp, FIN_DU_SOUS_AGENT);
  await readAndBroadcast(fp);
  await compactSession(fp);
  const recus = ecouterSSE();

  // Act
  await readAndBroadcast(fp);

  // Assert
  expect(finsRecues(recus), 'la fin du sous-agent a été rejouée').toBe(0);
});

test('un evenement ecrit mais pas encore lu est diffuse une fois apres la compaction', async () => {
  // Arrange
  const fp = sessionLue('pas-encore-lu');
  fs.appendFileSync(fp, FIN_DU_SOUS_AGENT);
  await compactSession(fp);
  const recus = ecouterSSE();

  // Act
  await readAndBroadcast(fp);

  // Assert
  expect(finsRecues(recus), 'la fin du sous-agent n’a pas atteint le tableau de bord').toBe(1);
});

test('un evenement ecrit pendant la compaction reste dans le fichier', async () => {
  // Arrange
  const fp = sessionLue('ecrit-pendant-disque');

  // Act
  await compactSession(fp, lectureSuivieDUneEcriture(fp));

  // Assert
  const restant = fs.readFileSync(fp, 'utf8').trim().split('\n');
  expect(restant.at(-1), 'la réécriture a effacé la fin du sous-agent').toBe(FIN_DU_SOUS_AGENT.trim());
});

test('un evenement ecrit pendant la compaction est diffuse une fois', async () => {
  // Arrange
  const fp = sessionLue('ecrit-pendant-vif');
  await compactSession(fp, lectureSuivieDUneEcriture(fp));
  const recus = ecouterSSE();

  // Act
  await readAndBroadcast(fp);

  // Assert
  expect(finsRecues(recus), 'la fin du sous-agent n’a pas atteint le tableau de bord').toBe(1);
});

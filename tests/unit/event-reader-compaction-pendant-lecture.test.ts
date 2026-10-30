// La compaction tourne dans le même processus que le lecteur vif : elle peut réécrire
// le fichier pendant qu'une lecture attend entre la mesure de la taille et la pose du
// curseur. Le direct ne doit ni se figer ni perdre un événement.

import { afterAll, afterEach, beforeEach, expect, test, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SseClient } from '../../src/server/sse.ts';
import type { SessionRecord } from '../../src/server/session-index.ts';

// Redirige AVANT le premier import de `src/server/**` : session-index calcule
// son dossier d'événements depuis os.tmpdir() à son chargement.
const BAC = fs.mkdtempSync(path.join(os.tmpdir(), 'avtest-compaction-lecture-'));
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
const fin = (agent: string) => JSON.stringify({
  hook_event_name: 'SubagentStop', session_id: 's', agent_id: agent, _source: 'copilot',
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

const finsRecues = (recus: any[], agent: string) =>
  recus.filter(m => m.type === 'event' && m.event.hook_event_name === 'SubagentStop' && m.event.agent_id === agent).length;

// La lecture mesure la taille, puis la compaction réécrit le fichier avant qu'elle reprenne.
function mesurePuisCompaction(fp: string) {
  return async (p: string) => {
    const mesure = await fs.promises.stat(p);
    await compactSession(fp);
    return mesure;
  };
}

test('une lecture interrompue par la compaction ne fige pas le direct et ne perd rien', async () => {
  // Arrange
  const fp = sessionLue('compaction-pendant-lecture');
  fs.appendFileSync(fp, fin('avant'));
  const recus = ecouterSSE();
  await readAndBroadcast(fp, mesurePuisCompaction(fp));
  fs.appendFileSync(fp, fin('apres'));

  // Act
  await readAndBroadcast(fp);

  // Assert
  expect(finsRecues(recus, 'avant'), 'l’événement écrit avant la compaction n’a pas été diffusé une fois').toBe(1);
  expect(finsRecues(recus, 'apres'), 'le direct est figé : l’événement écrit après la compaction n’est pas diffusé').toBe(1);
});

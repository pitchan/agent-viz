// Le curseur d'une page qui suit une session : chaque événement diffusé en
// direct dit où finit sa ligne, et une page qui revient lit ce qu'elle n'a pas
// encore vu, même si le fichier a été compacté entre-temps.

import { afterAll, afterEach, beforeEach, expect, test, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SseClient } from '../../src/server/sse.ts';
import type { SessionRecord } from '../../src/server/session-index.ts';

// Redirige AVANT le premier import de `src/server/**` : session-index calcule
// son dossier d'événements depuis os.tmpdir() à son chargement.
const BAC = fs.mkdtempSync(path.join(os.tmpdir(), 'avtest-curseur-page-'));
process.env.TEMP = BAC;
process.env.TMP = BAC;
process.env.TMPDIR = BAC;

const { sseClients } = await import('../../src/server/sse.ts');
const { DIR, sessionIndex, COMPACT_KEEP_EVENTS } = await import('../../src/server/session-index.ts');
const { readAndBroadcast, readUnread, resetFileOffset, unwatchSession } = await import('../../src/server/event-reader.ts');
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

// L'accent compte : une fin de ligne se mesure en octets, pas en caractères.
const outil = (i: number) => JSON.stringify({
  hook_event_name: 'PreToolUse', session_id: 's', tool_name: 'Bash', tool_use_id: `t${i}`, command: 'écho', _source: 'copilot',
}) + '\n';
const FIN_DU_SOUS_AGENT = JSON.stringify({
  hook_event_name: 'SubagentStop', session_id: 's', agent_id: 'a1', _source: 'copilot',
}) + '\n';

// Une session de `lignes` événements, entièrement lue par le chemin vif.
// `agentSource: 'copilot'` et `promptCache: null` tiennent la transcription et
// la sonde du premier prompt hors de ce qu'on mesure ici.
function sessionLue(nom: string, lignes: number) {
  const contenu = Array.from({ length: lignes }, (_, i) => outil(i)).join('');
  const fp = path.join(DIR, `${nom}.jsonl`);
  fs.writeFileSync(fp, contenu);
  suivis.push(fp);
  const taille = Buffer.byteLength(contenu);
  sessionIndex.set(nom, {
    id: nom, promptCache: null, promptWindow: 0, mtime: Date.now(), agentSource: 'copilot',
    size: taille, eventCount: lignes,
  } as SessionRecord);
  resetFileOffset(fp, taille);
  return { fp, taille };
}

function ecouterSSE() {
  const recus: any[] = [];
  const client: SseClient = { write: (msg: string) => { recus.push(JSON.parse(msg.slice('data: '.length))); } };
  sseClients.add(client);
  auditeurs.push(client);
  return recus;
}

test('un evenement diffuse en direct porte la fin de sa ligne dans le fichier', async () => {
  // Arrange
  const { fp, taille } = sessionLue('fin-de-ligne', 2);
  fs.appendFileSync(fp, outil(2) + outil(3));
  const recus = ecouterSSE();

  // Act
  await readAndBroadcast(fp);

  // Assert
  const fins = [taille + Buffer.byteLength(outil(2)), taille + Buffer.byteLength(outil(2) + outil(3))];
  expect(recus.filter(m => m.type === 'event').map(m => [m.offset, m.layout])).toEqual([[fins[0], 0], [fins[1], 0]]);
});

test('une page revenue avec un curseur d avant la compaction lit une fois ce qui a ete ecrit pendant son absence', async () => {
  // Arrange — la page a tout lu, puis s'est masquée ; le hook écrit, le fichier est compacté.
  const { fp, taille } = sessionLue('absence-compaction', COMPACT_KEEP_EVENTS + 30);
  fs.appendFileSync(fp, FIN_DU_SOUS_AGENT);
  await readAndBroadcast(fp);
  await compactSession(fp);

  // Act
  const { data } = await readUnread(fp, taille, 0);

  // Assert
  expect(data).toBe(FIN_DU_SOUS_AGENT);
});

test('la reponse dit dans quelle mise en page du fichier tient le nouveau curseur', async () => {
  // Arrange
  const { fp, taille } = sessionLue('mise-en-page', COMPACT_KEEP_EVENTS + 30);
  await compactSession(fp);

  // Act
  const reponse = await readUnread(fp, taille, 0);

  // Assert
  expect([reponse.size, reponse.layout]).toEqual([fs.statSync(fp).size, 1]);
});

test('une page qui suit le direct apres une compaction ne relit rien', async () => {
  // Arrange
  const { fp } = sessionLue('direct-apres-compaction', COMPACT_KEEP_EVENTS + 30);
  await compactSession(fp);
  const recus = ecouterSSE();
  fs.appendFileSync(fp, FIN_DU_SOUS_AGENT);
  await readAndBroadcast(fp);
  const dernier = recus.filter(m => m.type === 'event').at(-1);

  // Act
  const { data } = await readUnread(fp, dernier.offset, dernier.layout);

  // Assert
  expect(data).toBe('');
});

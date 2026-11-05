// La compaction tourne dans le même processus que le rattrapage d'une page : elle peut
// réécrire le fichier pendant que GET /events attend la taille ou la lecture. La page
// ne doit perdre aucun événement, ni sur cette réponse ni sur les suivantes.

import { afterAll, afterEach, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SessionRecord } from '../../src/server/session-index.ts';
import type { EventCursor } from '../../src/web/viz-event-cursor.ts';

// Redirige AVANT le premier import de `src/server/**` : session-index calcule
// son dossier d'événements depuis os.tmpdir() à son chargement.
const BAC = fs.mkdtempSync(path.join(os.tmpdir(), 'avtest-rattrapage-compaction-'));
process.env.TEMP = BAC;
process.env.TMP = BAC;
process.env.TMPDIR = BAC;

const { DIR, sessionIndex, COMPACT_KEEP_EVENTS } = await import('../../src/server/session-index.ts');
const { readUnread, resetFileOffset, unwatchSession } = await import('../../src/server/event-reader.ts');
const { compactSession } = await import('../../src/server/housekeep.ts');
const { catchUp } = await import('../../src/web/viz-event-cursor.ts');

const suivis: string[] = [];
afterEach(() => { for (const fp of suivis.splice(0)) unwatchSession(fp); });
afterAll(() => { fs.rmSync(BAC, { recursive: true, force: true }); });

test('bac a sable: le dossier d evenements est celui du test', () => {
  expect(DIR.startsWith(BAC), `dossier d evenements hors du bac : ${DIR}`).toBeTruthy();
});

const outil = (i: number) => JSON.stringify({
  hook_event_name: 'PreToolUse', session_id: 's', tool_name: 'Bash', tool_use_id: `t${i}`, _source: 'copilot',
}) + '\n';

const LIGNES = COMPACT_KEEP_EVENTS + 30;
const lignesDe = (n: number) => Array.from({ length: n }, (_, i) => outil(i)).join('');

// Une session au-delà du seuil de compaction, que la page a lue jusqu'à `lues` lignes.
// `agentSource: 'copilot'` et `promptCache: null` tiennent la transcription et
// la sonde du premier prompt hors de ce qu'on mesure ici.
function sessionLueParLaPage(nom: string, lues: number): { fp: string; curseur: EventCursor } {
  const lignes = LIGNES;
  const contenu = lignesDe(lignes);
  const fp = path.join(DIR, `${nom}.jsonl`);
  fs.writeFileSync(fp, contenu);
  suivis.push(fp);
  const taille = Buffer.byteLength(contenu);
  sessionIndex.set(nom, {
    id: nom, promptCache: null, promptWindow: 0, mtime: Date.now(), agentSource: 'copilot',
    size: taille, eventCount: lignes,
  } as SessionRecord);
  resetFileOffset(fp, taille);
  return { fp, curseur: { offset: Buffer.byteLength(lignesDe(lues)), layout: 0 } };
}

type Stat = (p: string) => Promise<{ size: number }>;
type Read = (p: string, buf: Buffer, offset: number) => Promise<number>;

// Une ligne reçue que la page ne peut pas décoder est un événement perdu : elle reste visible.
function idDe(ligne: string): string {
  try { return JSON.parse(ligne).tool_use_id; } catch { return `illisible: ${JSON.stringify(ligne.slice(0, 30))}`; }
}

// Ce que fait la page à son retour : GET /events depuis son curseur, puis traitement.
async function retourDeLaPage(fp: string, curseur: EventCursor, stat?: Stat, read?: Read) {
  const rep = await readUnread(fp, curseur.offset, curseur.layout, stat, read);
  const { lines, cursor } = catchUp(curseur, new Uint8Array(Buffer.from(rep.data, 'utf8')), rep.size, rep.layout);
  return { ids: lines.map(idDe), curseur: cursor };
}

// La page s'absente, le hook écrit, la compaction tourne pendant le premier retour,
// le hook écrit encore, la page revient une seconde fois.
async function deuxRetoursAutourDUneCompaction(nom: string, lues: number, injection: (fp: string) => { stat?: Stat; read?: Read }) {
  const { fp, curseur } = sessionLueParLaPage(nom, lues);
  fs.appendFileSync(fp, outil(1000) + outil(1001));
  const { stat, read } = injection(fp);
  const premier = await retourDeLaPage(fp, curseur, stat, read);
  fs.appendFileSync(fp, outil(2000) + outil(2001) + outil(2002));
  const second = await retourDeLaPage(fp, premier.curseur);
  return { ids: [...premier.ids, ...second.ids], curseur: second.curseur, taille: fs.statSync(fp).size };
}

const ATTENDUS = ['t1000', 't1001', 't2000', 't2001', 't2002'];

// La mesure de la taille aboutit, puis la compaction réécrit le fichier avant qu'elle reprenne.
const pendantLaMesure = (fp: string) => ({
  stat: async (p: string) => {
    const mesure = await fs.promises.stat(p);
    await compactSession(fp);
    return mesure;
  },
});

// La compaction réécrit le fichier pendant que la lecture attend, avant que ses octets soient lus.
const pendantLaLecture = (fp: string) => ({
  read: async (p: string, buf: Buffer, offset: number) => {
    await compactSession(fp);
    const fh = await fs.promises.open(p, 'r');
    const { bytesRead } = await fh.read(buf, 0, buf.length, offset);
    await fh.close();
    return bytesRead;
  },
});

test('une compaction pendant la mesure du rattrapage ne fait perdre aucun evenement a la page', async () => {
  // Arrange
  const nom = 'compaction-pendant-mesure';

  // Act
  const r = await deuxRetoursAutourDUneCompaction(nom, LIGNES, pendantLaMesure);

  // Assert
  expect(r.ids, 'la page n’a pas reçu une fois chaque événement écrit pendant ses absences').toEqual(ATTENDUS);
  expect(r.curseur, 'le curseur de la page ne tient pas dans le fichier compacté').toEqual({ offset: r.taille, layout: 1 });
});

test('une compaction pendant la lecture du rattrapage ne fait perdre aucun evenement a la page', async () => {
  // Arrange
  const nom = 'compaction-pendant-lecture-rattrapage';

  // Act
  const r = await deuxRetoursAutourDUneCompaction(nom, LIGNES, pendantLaLecture);

  // Assert
  expect(r.ids, 'la page n’a pas reçu une fois chaque événement écrit pendant ses absences').toEqual(ATTENDUS);
  expect(r.curseur, 'le curseur de la page ne tient pas dans le fichier compacté').toEqual({ offset: r.taille, layout: 1 });
});

// Une page restée en arrière : la compaction garde des lignes qu'elle n'a pas encore lues,
// et ce qui a été mesuré ou lu avant elle ne vaut plus pour le fichier réécrit.
const LUES_EN_RETARD = 50;
const ATTENDUS_EN_RETARD = [...Array.from({ length: LIGNES - LUES_EN_RETARD }, (_, i) => `t${LUES_EN_RETARD + i}`), ...ATTENDUS];

test('une compaction pendant la mesure du rattrapage d une page en retard ne lui fait perdre aucun evenement', async () => {
  // Arrange
  const nom = 'retard-compaction-pendant-mesure';

  // Act
  const r = await deuxRetoursAutourDUneCompaction(nom, LUES_EN_RETARD, pendantLaMesure);

  // Assert
  expect(r.ids, 'la page n’a pas reçu une fois chaque événement qu’elle n’avait pas lu').toEqual(ATTENDUS_EN_RETARD);
  expect(r.curseur, 'le curseur de la page ne tient pas dans le fichier compacté').toEqual({ offset: r.taille, layout: 1 });
});

test('une compaction pendant la lecture du rattrapage d une page en retard ne lui fait perdre aucun evenement', async () => {
  // Arrange
  const nom = 'retard-compaction-pendant-lecture';

  // Act
  const r = await deuxRetoursAutourDUneCompaction(nom, LUES_EN_RETARD, pendantLaLecture);

  // Assert
  expect(r.ids, 'la page n’a pas reçu une fois chaque événement qu’elle n’avait pas lu').toEqual(ATTENDUS_EN_RETARD);
  expect(r.curseur, 'le curseur de la page ne tient pas dans le fichier compacté').toEqual({ offset: r.taille, layout: 1 });
});

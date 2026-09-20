// Filet de CARACTÉRISATION pour src/server/housekeep.ts : `compactSession` garde
// la queue d'un fichier de session et résume toute son histoire, en décodant chaque
// ligne par `decodeJsonlLine`.
//
// Nature des tests : CARACTÉRISATION, pas spécification. Ils épinglent le
// comportement ACTUEL, verrues comprises : un test rouge pose la question « le
// changement est-il voulu ? », pas « comment le faire repasser au vert ? ».

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, expect, test } from 'vitest';
import type { SessionRecord } from '../../src/server/session-index.ts';

// Le dossier de travail est calculé une fois pour toutes par session-index,
// depuis os.tmpdir(). On le redirige AVANT le chargement du module — un import
// dynamique, plus bas, s'assure que session-index.ts et housekeep.ts le lisent
// APRES cette redirection plutot qu'a leur hissage statique.
const RACINE = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-viz-housekeep-'));
process.env.TMPDIR = RACINE;
process.env.TEMP = RACINE;
process.env.TMP = RACINE;

const { sessionIndex, idFromPath, COMPACT_KEEP_EVENTS } = await import('../../src/server/session-index.ts');
const { compactSession } = await import('../../src/server/housekeep.ts');

const DOSSIER = path.join(RACINE, 'agent-events');
fs.mkdirSync(DOSSIER, { recursive: true });

afterAll(() => { fs.rmSync(RACINE, { recursive: true, force: true }); });

let compteur = 0;

// Écrit un fichier de session et l'inscrit dans l'index (compactSession sort
// immédiatement si l'index n'a pas d'entrée pour ce fichier).
function poseUneSession(lignes: string[], { indexe = true }: { indexe?: boolean } = {}) {
  const fp = path.join(DOSSIER, `sess-${++compteur}.jsonl`);
  fs.writeFileSync(fp, lignes.join('\n') + '\n');
  const id = idFromPath(fp);
  if (indexe) sessionIndex.set(id, { id, promptCache: null, size: 0, eventCount: 0 } as SessionRecord);
  return { fp, id, resume: fp.replace('.jsonl', '.summary.json') };
}

// Un événement outil, celui que le résumé recense.
function evenementOutil(i: number) {
  return JSON.stringify({
    hook_event_name: 'PreToolUse', tool_name: 'Read', tool_use_id: `t${i}`, _ts: `2026-08-10T00:00:${String(i % 60).padStart(2, '0')}.000Z`,
  });
}

function litResume(chemin: string) {
  return JSON.parse(fs.readFileSync(chemin, 'utf8'));
}

test('le seuil de compaction est bien celui que ces tests supposent', () => {
  expect(COMPACT_KEEP_EVENTS,
    'COMPACT_KEEP_EVENTS a bougé — les tailles choisies ci-dessous ne testent plus ce qu’elles annoncent').toBe(100);
});

test('au-delà du seuil : la queue est conservée, le résumé compte TOUTE l’histoire', async () => {
  const total = COMPACT_KEEP_EVENTS + 30;
  const s = poseUneSession(Array.from({ length: total }, (_, i) => evenementOutil(i)));

  await compactSession(s.fp);

  const restant = fs.readFileSync(s.fp, 'utf8').trim().split('\n');
  expect(restant.length, 'le fichier ne garde pas exactement la queue').toBe(COMPACT_KEEP_EVENTS);
  expect(JSON.parse(restant[0]!).tool_use_id,
    'la queue conservée ne commence pas au bon événement').toBe(`t${total - COMPACT_KEEP_EVENTS}`);

  const resume = litResume(s.resume);
  expect(resume.totalEvents, 'le résumé doit compter les lignes AVANT la coupe').toBe(total);
  expect(resume.tools.length, 'les outils sont recensés sur toute l’histoire, pas sur la queue').toBe(total);
  expect(resume.id).toBe(s.id);

  // L’index est remis d’aplomb sur le nouveau fichier, plus petit.
  const rec = sessionIndex.get(s.id)!;
  expect(rec.eventCount).toBe(COMPACT_KEEP_EVENTS);
  expect(rec.size).toBe(fs.statSync(s.fp).size);
});

test('en deçà du seuil : rien n’est touché, aucun résumé n’est écrit', async () => {
  const s = poseUneSession(Array.from({ length: COMPACT_KEEP_EVENTS }, (_, i) => evenementOutil(i)));
  const avant = fs.readFileSync(s.fp, 'utf8');

  await compactSession(s.fp);

  expect(fs.readFileSync(s.fp, 'utf8'), 'le fichier a été réécrit alors qu’il est sous le seuil').toBe(avant);
  expect(fs.existsSync(s.resume), 'un résumé a été écrit sous le seuil').toBe(false);
});

test('sans entrée dans l’index, la compaction ne fait rien du tout', async () => {
  const s = poseUneSession(Array.from({ length: COMPACT_KEEP_EVENTS + 30 }, (_, i) => evenementOutil(i)), { indexe: false });
  const avant = fs.readFileSync(s.fp, 'utf8');

  await compactSession(s.fp);

  expect(fs.readFileSync(s.fp, 'utf8')).toBe(avant);
  expect(fs.existsSync(s.resume)).toBe(false);
});

// --- Ce que ce décodeur fait des lignes qu'il n'arrive pas à lire.

test('CARACTÉRISATION — une ligne illisible est comptée dans totalEvents mais perdue pour les outils', async () => {
  const bonnes = Array.from({ length: COMPACT_KEEP_EVENTS + 20 }, (_, i) => evenementOutil(i));
  const lignes = [...bonnes];
  lignes.splice(5, 0, '{tronquee'); // insérée tôt, donc hors de la queue conservée
  const s = poseUneSession(lignes);

  await compactSession(s.fp);

  const resume = litResume(s.resume);
  expect(resume.totalEvents,
    'totalEvents compte les LIGNES, pas les événements décodés — verrue épinglée volontairement').toBe(lignes.length);
  // Assertion discriminante : un simple compte passerait aussi si une AUTRE
  // ligne avait été perdue. On vérifie que les bonnes sont toutes là.
  const vus = new Set(resume.tools.map((t: any) => t.id));
  expect(vus.size, 'exactement les lignes valides doivent être recensées').toBe(bonnes.length);
  for (let i = 0; i < bonnes.length; i++) {
    expect(vus.has(`t${i}`), `l’événement t${i}, pourtant valide, a disparu du résumé`).toBe(true);
  }
});

// Un BOM au milieu du fichier ne fait pas disparaître l’événement du résumé : le
// décodage commun le tolère partout, comme dans le moteur.
test('un BOM est toléré où qu’il soit dans le fichier', async () => {
  const BOM = String.fromCharCode(0xFEFF);
  const lignes = Array.from({ length: COMPACT_KEEP_EVENTS + 20 }, (_, i) => evenementOutil(i));
  lignes[3] = BOM + lignes[3]; // au milieu : aucun `content.trim()` ne peut l’atteindre
  const s = poseUneSession(lignes);

  await compactSession(s.fp);

  const resume = litResume(s.resume);
  const vus = new Set(resume.tools.map((t: any) => t.id));
  expect(vus.has('t3'),
    'l’événement préfixé d’un BOM est décodé, pas perdu').toBe(true);
  expect(vus.size, 'aucune ligne ne manque').toBe(lignes.length);
});

test('CARACTÉRISATION — une ligne vide au milieu est traitée comme une ligne illisible', async () => {
  const lignes = Array.from({ length: COMPACT_KEEP_EVENTS + 20 }, (_, i) => evenementOutil(i));
  lignes.splice(7, 0, '');
  const s = poseUneSession(lignes);

  await compactSession(s.fp);

  const resume = litResume(s.resume);
  expect(resume.totalEvents, 'la ligne vide du milieu compte comme une ligne').toBe(lignes.length);
  expect(resume.tools.length, 'et ne produit aucun outil').toBe(lignes.length - 1);
});

test('CARACTÉRISATION — le saut de ligne final ne fabrique PAS de ligne fantôme (trim avant découpe)', async () => {
  const lignes = Array.from({ length: COMPACT_KEEP_EVENTS + 20 }, (_, i) => evenementOutil(i));
  const s = poseUneSession(lignes); // poseUneSession ajoute un '\n' final
  expect(fs.readFileSync(s.fp, 'utf8').endsWith('\n'), 'le fichier doit bien finir par un saut de ligne').toBe(true);

  await compactSession(s.fp);

  expect(litResume(s.resume).totalEvents,
    'un saut de ligne final ne doit pas ajouter une ligne au compte').toBe(lignes.length);
});

test('CARACTÉRISATION — seuls les trois événements d’outil alimentent le résumé', async () => {
  const lignes = Array.from({ length: COMPACT_KEEP_EVENTS + 10 }, (_, i) => evenementOutil(i));
  lignes.push(JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_use_id: 'p1' }));
  lignes.push(JSON.stringify({ hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_use_id: 'p2' }));
  lignes.push(JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt: 'ignore-moi' }));
  const s = poseUneSession(lignes);

  await compactSession(s.fp);

  const resume = litResume(s.resume);
  expect(resume.tools.length, 'UserPromptSubmit ne doit pas produire d’entrée d’outil').toBe(lignes.length - 1);
  const noms = new Set(resume.tools.map((t: any) => t.event));
  expect([...noms].sort()).toEqual(['PostToolUse', 'PostToolUseFailure', 'PreToolUse']);
});

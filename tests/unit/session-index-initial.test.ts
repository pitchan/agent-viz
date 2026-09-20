// Filet de CARACTÉRISATION pour src/server/session-index.ts : `indexSessionInitial`
// décode la première ligne (4 premiers Ko) pour en tirer `_source`, et
// `countNewlinesStreaming` compte les sauts de ligne.
//
// `sessionFilePath`, `latestSession` et la branche de création de `touchIndex`
// restent non couverts À DESSEIN : gonfler un pourcentage n'est pas le but.
//
// Nature : CARACTÉRISATION. Ces tests épinglent le comportement ACTUEL, angles
// morts compris : un test rouge pose la question « ce changement est-il voulu ? »,
// il ne demande pas à être contourné.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, expect, test } from 'vitest';

// Redirection du dossier de travail AVANT le premier import : session-index
// calcule DIR depuis os.tmpdir() au chargement, et crée le dossier dans la
// foulée. Un import statique s'évaluerait avant ces lignes ; un import
// dynamique, plus bas, s'assure que le module le lit APRES cette redirection.
const RACINE = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-viz-sessidx-'));
process.env.TMPDIR = RACINE;
process.env.TEMP = RACINE;
process.env.TMP = RACINE;

const {
  DIR, sessionIndex, idFromPath,
  countNewlinesStreaming, indexSessionInitial,
} = await import('../../src/server/session-index.ts');

afterAll(() => { fs.rmSync(RACINE, { recursive: true, force: true }); });

let compteur = 0;

function poseUnFichier(contenu: string) {
  const fp = path.join(DIR, `sess-${++compteur}.jsonl`);
  fs.writeFileSync(fp, contenu);
  return { fp, id: idFromPath(fp) };
}

function evenement(champs: Record<string, unknown>) {
  return JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Read', ...champs });
}

test('DIR est bien redirigé dans le dossier jetable de ce test', () => {
  expect(DIR.startsWith(RACINE), 'la redirection par TMPDIR/TEMP/TMP n’a pas pris — le test écrirait dans le vrai dossier de sessions').toBe(true);
});

// ── countNewlinesStreaming ──────────────────────────────────────────────────

test('countNewlinesStreaming compte les sauts de ligne, pas les événements', async () => {
  const { fp } = poseUnFichier('a\nb\nc\n');
  expect(await countNewlinesStreaming(fp)).toBe(3);
});

test('CARACTÉRISATION — sans saut de ligne final, la dernière ligne n’est pas comptée', async () => {
  const { fp } = poseUnFichier('a\nb\nc');
  expect(await countNewlinesStreaming(fp), 'le compteur compte des séparateurs, pas des enregistrements : une dernière ligne sans ' +
    '\\n est invisible. Angle mort épinglé volontairement.').toBe(2);
});

test('countNewlinesStreaming rend 0 sur un fichier absent, sans lever', async () => {
  expect(await countNewlinesStreaming(path.join(DIR, 'jamais-ecrit.jsonl'))).toBe(0);
});

// ── indexSessionInitial : le décodage de la première ligne ──────────────────

test('la source de l’agent est reprise du champ _source du premier événement', async () => {
  const { fp, id } = poseUnFichier(evenement({ _source: 'copilot' }) + '\n' + evenement({ _source: 'claude' }) + '\n');

  await indexSessionInitial(fp);

  const rec = sessionIndex.get(id)!;
  expect(rec.agentSource, 'c’est le PREMIER événement qui fait foi').toBe('copilot');
  expect(rec.eventCount).toBe(2);
  expect(rec.size).toBe(fs.statSync(fp).size);
});

test('CARACTÉRISATION — _source absent laisse agentSource indéfini, jamais « claude » par défaut', async () => {
  const { fp, id } = poseUnFichier(evenement({}) + '\n');

  await indexSessionInitial(fp);

  expect(sessionIndex.get(id)!.agentSource, 'le commentaire du module l’exige : ne pas coercer silencieusement vers « claude »').toBe(undefined);
});

// Le décodage commun tolère le BOM, comme le moteur : une première ligne qui en
// porte un garde sa source d'agent.
test('une première ligne préfixée d’un BOM garde agentSource', async () => {
  const BOM = String.fromCharCode(0xFEFF);
  const { fp, id } = poseUnFichier(BOM + evenement({ _source: 'copilot' }) + '\n');

  await indexSessionInitial(fp);

  const rec = sessionIndex.get(id)!;
  expect(rec).not.toBe(undefined);
  expect(rec.agentSource, 'le BOM ne coûte pas la source de l’agent').toBe('copilot');
  expect(rec.eventCount).toBe(1);
});

test('CARACTÉRISATION — une première ligne illisible laisse toujours une trace journalisée', async () => {
  // Le décodeur ne lève jamais, donc aucun `catch` ne sert de filet : c'est le
  // verdict `{ok:false}` qui doit être lu. On vérifie que l'échec reste VISIBLE,
  // jamais silencieux.
  const { fp, id } = poseUnFichier('{tronquee\n' + evenement({ _source: 'copilot' }) + '\n');
  const erreurs: string[] = [];
  const original = console.error;
  console.error = msg => erreurs.push(String(msg));
  try {
    await indexSessionInitial(fp);
  } finally {
    console.error = original;
  }

  expect(sessionIndex.get(id)!.agentSource, 'une première ligne cassée ne donne pas de source').toBe(undefined);
  expect(erreurs.length, 'l’échec doit laisser exactement une trace').toBe(1);
  expect(erreurs[0], 'la trace doit nommer la cause').toMatch(/première ligne illisible/);
});

test('CARACTÉRISATION — une première ligne de plus de 4 Ko est tronquée, donc illisible', async () => {
  // La sonde ne lit que les 4096 premiers octets : une première ligne plus
  // longue est coupée au milieu et ne peut plus être analysée.
  const bourrage = 'x'.repeat(5000);
  const { fp, id } = poseUnFichier(evenement({ _source: 'copilot', bourrage }) + '\n');
  expect(fs.statSync(fp).size > 4096, 'la première ligne doit bien dépasser 4 Ko').toBe(true);

  await indexSessionInitial(fp);

  expect(sessionIndex.get(id)!.agentSource, 'comportement ACTUEL : au-delà de 4 Ko la première ligne est tronquée et _source est perdu, ' +
    'même s’il est présent dans le fichier. Limite de la sonde, pas du format.').toBe(undefined);
});

test('CARACTÉRISATION — un fichier vide est indexé sans erreur et sans source', async () => {
  const { fp, id } = poseUnFichier('');

  await indexSessionInitial(fp);

  const rec = sessionIndex.get(id)!;
  expect(rec).not.toBe(undefined);
  expect(rec.agentSource).toBe(undefined);
  expect(rec.eventCount).toBe(0);
  expect(rec.size).toBe(0);
});

test('indexSessionInitial est idempotente : un second appel ne réécrit pas l’entrée', async () => {
  const { fp, id } = poseUnFichier(evenement({ _source: 'copilot' }) + '\n');
  await indexSessionInitial(fp);
  const premier = sessionIndex.get(id)!;

  // On marque l'entrée, puis on rappelle : la marque doit survivre.
  premier.marqueDeTest = 'intacte';
  fs.appendFileSync(fp, evenement({ _source: 'claude' }) + '\n');
  await indexSessionInitial(fp);

  const second = sessionIndex.get(id)!;
  expect(second.marqueDeTest, 'l’entrée a été recréée alors qu’elle existait déjà').toBe('intacte');
  expect(second.eventCount, 'le compte n’est pas rafraîchi par un second appel — c’est touchIndex qui s’en charge').toBe(1);
});

test('un fichier absent ne lève pas et n’inscrit rien', async () => {
  const fp = path.join(DIR, 'sess-inexistante.jsonl');

  await indexSessionInitial(fp);

  expect(sessionIndex.has(idFromPath(fp))).toBe(false);
});

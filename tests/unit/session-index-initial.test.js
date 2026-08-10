'use strict';
// Filet de CARACTÉRISATION pour lib/server/session-index.js — second et dernier
// morceau de préparation de C2 (docs/audit-qualite-code.md : le décodage JSONL
// est réimplémenté sur 7 fichiers côté serveur).
//
// Périmètre volontairement étroit : on épingle `indexSessionInitial` et
// `countNewlinesStreaming`, parce que la première porte l'une des sept
// réimplémentations du décodage — elle lit les 4 premiers Ko du fichier,
// découpe sur '\n', et analyse la première ligne pour en tirer `_source`.
// `sessionFilePath`, `latestSession` et la branche de création de `touchIndex`
// restent non couverts À DESSEIN : ils ne participent pas au geste que C2 va
// consolider, et gonfler un pourcentage n'est pas le but.
//
// Nature : CARACTÉRISATION. Ces tests épinglent le comportement ACTUEL, y
// compris ses angles morts. Un test qui devient rouge pendant C2 pose une
// question — « ce changement est-il voulu ? » — il ne demande pas à être
// contourné.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Redirection du dossier de travail AVANT le premier require : session-index
// calcule DIR depuis os.tmpdir() au chargement, et crée le dossier dans la
// foulée. `node --test` donne un processus par fichier de test.
const RACINE = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-viz-sessidx-'));
process.env.TMPDIR = RACINE;
process.env.TEMP = RACINE;
process.env.TMP = RACINE;

const { test, after } = require('node:test');
const assert = require('node:assert/strict');

const {
  DIR, sessionIndex, idFromPath,
  countNewlinesStreaming, indexSessionInitial,
} = require('../../lib/server/session-index.js');

after(() => { fs.rmSync(RACINE, { recursive: true, force: true }); });

let compteur = 0;

function poseUnFichier(contenu) {
  const fp = path.join(DIR, `sess-${++compteur}.jsonl`);
  fs.writeFileSync(fp, contenu);
  return { fp, id: idFromPath(fp) };
}

function evenement(champs) {
  return JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Read', ...champs });
}

test('DIR est bien redirigé dans le dossier jetable de ce test', () => {
  assert.equal(DIR.startsWith(RACINE), true,
    'la redirection par TMPDIR/TEMP/TMP n’a pas pris — le test écrirait dans le vrai dossier de sessions');
});

// ── countNewlinesStreaming ──────────────────────────────────────────────────

test('countNewlinesStreaming compte les sauts de ligne, pas les événements', async () => {
  const { fp } = poseUnFichier('a\nb\nc\n');
  assert.equal(await countNewlinesStreaming(fp), 3);
});

test('CARACTÉRISATION — sans saut de ligne final, la dernière ligne n’est pas comptée', async () => {
  const { fp } = poseUnFichier('a\nb\nc');
  assert.equal(await countNewlinesStreaming(fp), 2,
    'le compteur compte des séparateurs, pas des enregistrements : une dernière ligne sans ' +
    '\\n est invisible. Angle mort épinglé volontairement.');
});

test('countNewlinesStreaming rend 0 sur un fichier absent, sans lever', async () => {
  assert.equal(await countNewlinesStreaming(path.join(DIR, 'jamais-ecrit.jsonl')), 0);
});

// ── indexSessionInitial : le geste de décodage que C2 va consolider ─────────

test('la source de l’agent est reprise du champ _source du premier événement', async () => {
  const { fp, id } = poseUnFichier(evenement({ _source: 'copilot' }) + '\n' + evenement({ _source: 'claude' }) + '\n');

  await indexSessionInitial(fp);

  const rec = sessionIndex.get(id);
  assert.equal(rec.agentSource, 'copilot', 'c’est le PREMIER événement qui fait foi');
  assert.equal(rec.eventCount, 2);
  assert.equal(rec.size, fs.statSync(fp).size);
});

test('CARACTÉRISATION — _source absent laisse agentSource indéfini, jamais « claude » par défaut', async () => {
  const { fp, id } = poseUnFichier(evenement({}) + '\n');

  await indexSessionInitial(fp);

  assert.equal(sessionIndex.get(id).agentSource, undefined,
    'le commentaire du module l’exige : ne pas coercer silencieusement vers « claude »');
});

// CHANGEMENT DE COMPORTEMENT, assumé et daté — C2, 2026-08-11.
//
// Ce test épinglait la perte : le BOM faisait échouer le `JSON.parse` local de
// la sonde, `_source` était perdu, et seule une ligne sur `console.error` en
// gardait trace. Il est passé au ROUGE au moment où `indexSessionInitial` a
// adopté `decodeJsonlLine`. Changement voulu, même arbitrage que partout :
// tolérer le BOM, comme le moteur.
test('C2 — une première ligne préfixée d’un BOM ne fait plus perdre agentSource', async () => {
  const BOM = String.fromCharCode(0xFEFF);
  const { fp, id } = poseUnFichier(BOM + evenement({ _source: 'copilot' }) + '\n');

  await indexSessionInitial(fp);

  const rec = sessionIndex.get(id);
  assert.notEqual(rec, undefined);
  assert.equal(rec.agentSource, 'copilot', 'le BOM ne doit plus coûter la source de l’agent');
  assert.equal(rec.eventCount, 1);
});

test('CARACTÉRISATION — une première ligne illisible laisse toujours une trace journalisée', async () => {
  // Le décodeur ne lève plus, donc le `catch` ne peut plus servir de filet :
  // c'est le verdict `{ok:false}` qui doit être lu. On vérifie que l'échec reste
  // VISIBLE — la leçon de C1 : ne jamais échouer en silence.
  const { fp, id } = poseUnFichier('{tronquee\n' + evenement({ _source: 'copilot' }) + '\n');
  const erreurs = [];
  const original = console.error;
  console.error = msg => erreurs.push(String(msg));
  try {
    await indexSessionInitial(fp);
  } finally {
    console.error = original;
  }

  assert.equal(sessionIndex.get(id).agentSource, undefined, 'une première ligne cassée ne donne pas de source');
  assert.equal(erreurs.length, 1, 'l’échec doit laisser exactement une trace');
  assert.match(erreurs[0], /première ligne illisible/, 'la trace doit nommer la cause');
});

test('CARACTÉRISATION — une première ligne de plus de 4 Ko est tronquée, donc illisible', async () => {
  // La sonde ne lit que les 4096 premiers octets : une première ligne plus
  // longue est coupée au milieu et ne peut plus être analysée.
  const bourrage = 'x'.repeat(5000);
  const { fp, id } = poseUnFichier(evenement({ _source: 'copilot', bourrage }) + '\n');
  assert.equal(fs.statSync(fp).size > 4096, true, 'la première ligne doit bien dépasser 4 Ko');

  await indexSessionInitial(fp);

  assert.equal(sessionIndex.get(id).agentSource, undefined,
    'comportement ACTUEL : au-delà de 4 Ko la première ligne est tronquée et _source est perdu, ' +
    'même s’il est présent dans le fichier. Limite de la sonde, pas du format.');
});

test('CARACTÉRISATION — un fichier vide est indexé sans erreur et sans source', async () => {
  const { fp, id } = poseUnFichier('');

  await indexSessionInitial(fp);

  const rec = sessionIndex.get(id);
  assert.notEqual(rec, undefined);
  assert.equal(rec.agentSource, undefined);
  assert.equal(rec.eventCount, 0);
  assert.equal(rec.size, 0);
});

test('indexSessionInitial est idempotente : un second appel ne réécrit pas l’entrée', async () => {
  const { fp, id } = poseUnFichier(evenement({ _source: 'copilot' }) + '\n');
  await indexSessionInitial(fp);
  const premier = sessionIndex.get(id);

  // On marque l'entrée, puis on rappelle : la marque doit survivre.
  premier.marqueDeTest = 'intacte';
  fs.appendFileSync(fp, evenement({ _source: 'claude' }) + '\n');
  await indexSessionInitial(fp);

  const second = sessionIndex.get(id);
  assert.equal(second.marqueDeTest, 'intacte', 'l’entrée a été recréée alors qu’elle existait déjà');
  assert.equal(second.eventCount, 1, 'le compte n’est pas rafraîchi par un second appel — c’est touchIndex qui s’en charge');
});

test('un fichier absent ne lève pas et n’inscrit rien', async () => {
  const fp = path.join(DIR, 'sess-inexistante.jsonl');

  await indexSessionInitial(fp);

  assert.equal(sessionIndex.has(idFromPath(fp)), false);
});

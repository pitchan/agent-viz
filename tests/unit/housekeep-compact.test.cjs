'use strict';
// Filet de CARACTÉRISATION pour src/server/housekeep.js — préparation de C2
// (docs/audit-qualite-code.md : le décodage JSONL est réimplémenté sur 7
// fichiers côté serveur).
//
// Pourquoi ce fichier existe : la mesure de couverture de l'audit donnait
// `housekeep.js` à 20,5 %, mais les 31 lignes « couvertes » sont les `require`
// et les accolades fermantes — AUCUN corps de fonction ne s'exécutait jamais.
// `compactSession` porte l'une des sept réimplémentations du décodage JSONL ;
// la consolider sans filet reviendrait à changer un comportement que personne
// n'a jamais observé.
//
// Nature des tests : CARACTÉRISATION, pas spécification. Ils épinglent le
// comportement ACTUEL, verrues comprises — notamment le fait que ce décodeur
// ne tolère PAS le BOM, contrairement à d'autres des sept. Si l'un d'eux
// devient rouge, la bonne question est « le changement est-il voulu ? », pas
// « comment le faire repasser au vert ? ».

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Le dossier de travail est calculé une fois pour toutes par session-index,
// depuis os.tmpdir(). On le redirige AVANT le premier require — `node --test`
// donne un processus par fichier de test, donc l'environnement posé ici ne
// fuit sur aucune autre suite.
const RACINE = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-viz-housekeep-'));
process.env.TMPDIR = RACINE;
process.env.TEMP = RACINE;
process.env.TMP = RACINE;

const { test, after } = require('node:test');
const assert = require('node:assert/strict');

const { sessionIndex, idFromPath, COMPACT_KEEP_EVENTS } = require('../../src/server/session-index.ts');
const { compactSession } = require('../../src/server/housekeep.ts');

const DOSSIER = path.join(RACINE, 'agent-events');
fs.mkdirSync(DOSSIER, { recursive: true });

after(() => { fs.rmSync(RACINE, { recursive: true, force: true }); });

let compteur = 0;

// Écrit un fichier de session et l'inscrit dans l'index (compactSession sort
// immédiatement si l'index n'a pas d'entrée pour ce fichier).
function poseUneSession(lignes, { indexe = true } = {}) {
  const fp = path.join(DOSSIER, `sess-${++compteur}.jsonl`);
  fs.writeFileSync(fp, lignes.join('\n') + '\n');
  const id = idFromPath(fp);
  if (indexe) sessionIndex.set(id, { id, promptCache: null, size: 0, eventCount: 0 });
  return { fp, id, resume: fp.replace('.jsonl', '.summary.json') };
}

// Un événement outil, celui que le résumé recense.
function evenementOutil(i) {
  return JSON.stringify({
    hook_event_name: 'PreToolUse', tool_name: 'Read', tool_use_id: `t${i}`, _ts: `2026-08-10T00:00:${String(i % 60).padStart(2, '0')}.000Z`,
  });
}

function litResume(chemin) {
  return JSON.parse(fs.readFileSync(chemin, 'utf8'));
}

test('le seuil de compaction est bien celui que ces tests supposent', () => {
  assert.equal(COMPACT_KEEP_EVENTS, 100,
    'COMPACT_KEEP_EVENTS a bougé — les tailles choisies ci-dessous ne testent plus ce qu’elles annoncent');
});

test('au-delà du seuil : la queue est conservée, le résumé compte TOUTE l’histoire', async () => {
  const total = COMPACT_KEEP_EVENTS + 30;
  const s = poseUneSession(Array.from({ length: total }, (_, i) => evenementOutil(i)));

  await compactSession(s.fp);

  const restant = fs.readFileSync(s.fp, 'utf8').trim().split('\n');
  assert.equal(restant.length, COMPACT_KEEP_EVENTS, 'le fichier ne garde pas exactement la queue');
  assert.equal(JSON.parse(restant[0]).tool_use_id, `t${total - COMPACT_KEEP_EVENTS}`,
    'la queue conservée ne commence pas au bon événement');

  const resume = litResume(s.resume);
  assert.equal(resume.totalEvents, total, 'le résumé doit compter les lignes AVANT la coupe');
  assert.equal(resume.tools.length, total, 'les outils sont recensés sur toute l’histoire, pas sur la queue');
  assert.equal(resume.id, s.id);

  // L’index est remis d’aplomb sur le nouveau fichier, plus petit.
  const rec = sessionIndex.get(s.id);
  assert.equal(rec.eventCount, COMPACT_KEEP_EVENTS);
  assert.equal(rec.size, fs.statSync(s.fp).size);
});

test('en deçà du seuil : rien n’est touché, aucun résumé n’est écrit', async () => {
  const s = poseUneSession(Array.from({ length: COMPACT_KEEP_EVENTS }, (_, i) => evenementOutil(i)));
  const avant = fs.readFileSync(s.fp, 'utf8');

  await compactSession(s.fp);

  assert.equal(fs.readFileSync(s.fp, 'utf8'), avant, 'le fichier a été réécrit alors qu’il est sous le seuil');
  assert.equal(fs.existsSync(s.resume), false, 'un résumé a été écrit sous le seuil');
});

test('sans entrée dans l’index, la compaction ne fait rien du tout', async () => {
  const s = poseUneSession(Array.from({ length: COMPACT_KEEP_EVENTS + 30 }, (_, i) => evenementOutil(i)), { indexe: false });
  const avant = fs.readFileSync(s.fp, 'utf8');

  await compactSession(s.fp);

  assert.equal(fs.readFileSync(s.fp, 'utf8'), avant);
  assert.equal(fs.existsSync(s.resume), false);
});

// --- Le cœur de C2 : ce que ce décodeur fait des lignes qu'il n'arrive pas à lire.

test('CARACTÉRISATION — une ligne illisible est comptée dans totalEvents mais perdue pour les outils', async () => {
  const bonnes = Array.from({ length: COMPACT_KEEP_EVENTS + 20 }, (_, i) => evenementOutil(i));
  const lignes = [...bonnes];
  lignes.splice(5, 0, '{tronquee'); // insérée tôt, donc hors de la queue conservée
  const s = poseUneSession(lignes);

  await compactSession(s.fp);

  const resume = litResume(s.resume);
  assert.equal(resume.totalEvents, lignes.length,
    'totalEvents compte les LIGNES, pas les événements décodés — verrue épinglée volontairement');
  // Assertion discriminante : un simple compte passerait aussi si une AUTRE
  // ligne avait été perdue. On vérifie que les bonnes sont toutes là.
  const vus = new Set(resume.tools.map(t => t.id));
  assert.equal(vus.size, bonnes.length, 'exactement les lignes valides doivent être recensées');
  for (let i = 0; i < bonnes.length; i++) {
    assert.equal(vus.has(`t${i}`), true, `l’événement t${i}, pourtant valide, a disparu du résumé`);
  }
});

// CHANGEMENT DE COMPORTEMENT, assumé et daté — C2, 2026-08-11.
//
// Ce test épinglait l’inverse jusqu’au passage à la primitive commune : une
// ligne préfixée d’un BOM ailleurs qu’en tête de fichier était rejetée par le
// `JSON.parse` local, et l’événement disparaissait du résumé sans un mot. Il
// est passé au ROUGE quand `compactSession` a adopté `decodeJsonlLine` — c’est
// exactement ce pour quoi il avait été écrit : rendre le changement visible et
// obliger à le valider, au lieu de le laisser passer inaperçu.
//
// Arbitrage retenu : tolérer le BOM partout, comme le moteur le fait déjà.
test('C2 — un BOM est désormais toléré où qu’il soit dans le fichier', async () => {
  const BOM = String.fromCharCode(0xFEFF);
  const lignes = Array.from({ length: COMPACT_KEEP_EVENTS + 20 }, (_, i) => evenementOutil(i));
  lignes[3] = BOM + lignes[3]; // au milieu : aucun `content.trim()` ne peut l’atteindre
  const s = poseUneSession(lignes);

  await compactSession(s.fp);

  const resume = litResume(s.resume);
  const vus = new Set(resume.tools.map(t => t.id));
  assert.equal(vus.has('t3'), true,
    'l’événement préfixé d’un BOM doit maintenant être décodé, pas perdu');
  assert.equal(vus.size, lignes.length, 'aucune ligne ne doit plus manquer');
});

test('CARACTÉRISATION — une ligne vide au milieu est traitée comme une ligne illisible', async () => {
  const lignes = Array.from({ length: COMPACT_KEEP_EVENTS + 20 }, (_, i) => evenementOutil(i));
  lignes.splice(7, 0, '');
  const s = poseUneSession(lignes);

  await compactSession(s.fp);

  const resume = litResume(s.resume);
  assert.equal(resume.totalEvents, lignes.length, 'la ligne vide du milieu compte comme une ligne');
  assert.equal(resume.tools.length, lignes.length - 1, 'et ne produit aucun outil');
});

test('CARACTÉRISATION — le saut de ligne final ne fabrique PAS de ligne fantôme (trim avant découpe)', async () => {
  const lignes = Array.from({ length: COMPACT_KEEP_EVENTS + 20 }, (_, i) => evenementOutil(i));
  const s = poseUneSession(lignes); // poseUneSession ajoute un '\n' final
  assert.equal(fs.readFileSync(s.fp, 'utf8').endsWith('\n'), true, 'le fichier doit bien finir par un saut de ligne');

  await compactSession(s.fp);

  assert.equal(litResume(s.resume).totalEvents, lignes.length,
    'un saut de ligne final ne doit pas ajouter une ligne au compte');
});

test('CARACTÉRISATION — seuls les trois événements d’outil alimentent le résumé', async () => {
  const lignes = Array.from({ length: COMPACT_KEEP_EVENTS + 10 }, (_, i) => evenementOutil(i));
  lignes.push(JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_use_id: 'p1' }));
  lignes.push(JSON.stringify({ hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_use_id: 'p2' }));
  lignes.push(JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt: 'ignore-moi' }));
  const s = poseUneSession(lignes);

  await compactSession(s.fp);

  const resume = litResume(s.resume);
  assert.equal(resume.tools.length, lignes.length - 1, 'UserPromptSubmit ne doit pas produire d’entrée d’outil');
  const noms = new Set(resume.tools.map(t => t.event));
  assert.deepEqual([...noms].sort(), ['PostToolUse', 'PostToolUseFailure', 'PreToolUse']);
});

// D10 — l extension d un fichier de test est un CONTRAT, pas un detail.
//
// Les deux executeurs enumerent par motif d extension, jamais par contenu :
//   vitest        include: tests/**/*.test.{cjs,mjs,ts}   (vitest.config.mts)
//   node --test   glob:    tests/**/*.test.{cjs,mjs}      (scripts npm test:node)
// Un fichier de tests/ nomme *.test.<autre extension> n est lu par AUCUN des
// deux : il ne rougit jamais, ne tourne jamais, et sa presence dans l arbre se
// lit comme une couverture. Le defaut est SILENCIEUX — la famille exacte que ce
// dossier existe pour attraper (cf. D8 : le faux positif visible prefere au
// faux negatif silencieux).
//
// Le cas concret : l extension `.test.js`. Avant le step 1, 39 fichiers la
// portaient ; le renommage en `.test.cjs` l a rendue morte, et rien n empechait
// une main distraite d en recreer un — aucune consigne ne le disait, aucun
// filet ne le voyait. D9 (voisin) guette les CITATIONS d un ancien nom ;
// celui-ci guette la PRESENCE d un fichier qu aucun executeur ne lira.
//
// Meme famille que ses voisins de `tests/repo/` : il lit le vrai disque, ce
// n est pas un test unitaire (cf. `tests/CLAUDE.md` § 4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');

// L union de ce que les deux executeurs savent lire. Toute extension ajoutee
// ici doit D ABORD entrer dans leurs motifs (vitest.config.mts, scripts npm) —
// l inverse rendrait ce filet menteur.
const EXTENSIONS_LUES = new Set(['.cjs', '.mjs', '.ts']);

// `.test.` et `.spec.` : la seconde n est employee nulle part dans ce depot,
// mais un fichier qui la porterait serait invisible exactement de la meme
// facon (aucun motif ne dit `spec`) — autant l attraper ici que le decouvrir
// en post-mortem.
const NOM_DE_TEST = /\.(test|spec)\.[^.]+$/;

function fichiersDeTest() {
  const acc = [];
  const marche = dir => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) marche(abs);
      else if (NOM_DE_TEST.test(e.name)) acc.push(path.relative(ROOT, abs).replaceAll('\\', '/'));
    }
  };
  marche(path.join(ROOT, 'tests'));
  return acc;
}

test('tout fichier *.test.* ou *.spec.* sous tests/ porte une extension que les executeurs lisent', () => {
  // Arrange
  const tous = fichiersDeTest();

  // Act
  const invisibles = tous.filter(rel => !EXTENSIONS_LUES.has(path.extname(rel)));

  // Assert — l assiette est dite AVANT le verdict : un balayage qui ne voit
  // rien passerait aussi, et ne prouverait rien (119 fichiers au 2026-08-13).
  assert.ok(tous.length >= 100, `assiette suspecte : ${tous.length} fichiers de test vus, attendu >= 100`);
  assert.deepEqual(
    invisibles,
    [],
    'ce fichier n est lu par AUCUN des deux executeurs (vitest : .test.{cjs,mjs,ts} ; ' +
      'node --test : .test.{cjs,mjs}) : il ne tournera jamais, vert par absence. ' +
      'Le renommer vers une extension lue, ou etendre les motifs des executeurs ET ce filet ensemble.',
  );
});

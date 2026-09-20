// L extension d un fichier de test est un CONTRAT, pas un detail.
//
// Les deux executeurs enumerent par motif d extension, jamais par contenu :
//   vitest        include: tests/**/*.test.{cjs,mjs,ts}   (vitest.config.mts)
//   node --test   glob:    tests/**/*.test.{cjs,mjs}      (scripts npm test:node)
// Un fichier de tests/ nomme *.test.<autre extension> n est lu par AUCUN des
// deux : il ne rougit jamais, ne tourne jamais, et sa presence dans l arbre se
// lit comme une couverture. Le defaut est SILENCIEUX — la famille exacte que ce
// dossier existe pour attraper (le faux positif visible prefere au faux negatif
// silencieux).
//
// Le cas le plus probable : `.test.js`, l extension des tests CommonJS avant leur
// renommage en `.test.cjs`. `stale-path-citations.test.ts` guette les CITATIONS d un
// ancien nom ; celui-ci guette la PRESENCE d un fichier qu aucun executeur ne lira.
//
// Meme famille que ses voisins de `tests/repo/` : il lit le vrai disque, ce
// n est pas un test unitaire (cf. `tests/CLAUDE.md` § 4).
import { expect, test } from 'vitest';
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

// Dossiers qui ne font pas partie du produit : dependances, historique git,
// build, et .superpowers/, ou un arbre de travail d agent copie le depot entier.
const DOSSIERS_IGNORES = new Set(['node_modules', '.git', 'dist', '.superpowers']);

// Hors de tests/, aucun executeur ne lit un fichier de test : chaque exception
// dit pourquoi elle existe, et une exception qui ne couvre plus rien doit sortir.
const EXCEPTIONS = new Map([
  ['docs/audit/scripts/', 'outillage de l audit date : il se rejoue a la main, aucune suite ne le lance'],
]);

function fichiersDeTest() {
  const acc: string[] = [];
  const marche = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) marche(abs);
      else if (NOM_DE_TEST.test(e.name)) acc.push(path.relative(ROOT, abs).replaceAll('\\', '/'));
    }
  };
  marche(path.join(ROOT, 'tests'));
  return acc;
}

function fichiersDeTestHorsDeTests() {
  const acc: string[] = [];
  const marche = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      const rel = path.relative(ROOT, abs).replaceAll('\\', '/');
      if (e.isDirectory()) {
        if (!DOSSIERS_IGNORES.has(e.name) && rel !== 'tests') marche(abs);
      } else if (NOM_DE_TEST.test(e.name)) {
        acc.push(rel);
      }
    }
  };
  marche(ROOT);
  return acc;
}

const couvertParUneException = (rel: string) => [...EXCEPTIONS.keys()].some(prefixe => rel.startsWith(prefixe));

test('tout fichier *.test.* ou *.spec.* sous tests/ porte une extension que les executeurs lisent', () => {
  // Arrange
  const tous = fichiersDeTest();

  // Act
  const invisibles = tous.filter(rel => !EXTENSIONS_LUES.has(path.extname(rel)));

  // Assert — l assiette est dite AVANT le verdict : un balayage qui ne voit
  // rien passerait aussi, et ne prouverait rien.
  expect(tous.length >= 100, `assiette suspecte : ${tous.length} fichiers de test vus, attendu >= 100`).toBeTruthy();
  expect(invisibles, 'ce fichier n est lu par AUCUN des deux executeurs (vitest : .test.{cjs,mjs,ts} ; ' +
      'node --test : .test.{cjs,mjs}) : il ne tournera jamais, vert par absence. ' +
      'Le renommer vers une extension lue, ou etendre les motifs des executeurs ET ce filet ensemble.').toEqual([]);
});

test('aucun fichier *.test.* ou *.spec.* hors de tests/, sauf sous une exception nommee', () => {
  // Arrange
  const horsDeTests = fichiersDeTestHorsDeTests();

  // Act
  const nonCouverts = horsDeTests.filter(rel => !couvertParUneException(rel));

  // Assert
  expect(nonCouverts, 'les deux executeurs ne lisent que tests/ : ce fichier ne tournera jamais. ' +
      'Le deplacer sous tests/, ou inscrire son dossier dans EXCEPTIONS avec sa raison.').toEqual([]);
});

test('chaque exception d emplacement couvre encore au moins un fichier de test', () => {
  // Arrange
  const horsDeTests = fichiersDeTestHorsDeTests();

  // Act
  const orphelines = [...EXCEPTIONS.keys()].filter(prefixe => !horsDeTests.some(rel => rel.startsWith(prefixe)));

  // Assert
  expect(orphelines, 'une exception qui ne couvre plus aucun fichier doit sortir de EXCEPTIONS').toEqual([]);
});

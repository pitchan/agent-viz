// L extension d un fichier de test est un CONTRAT, pas un detail.
//
// vitest enumere par motif d extension, jamais par contenu :
//   include: tests/**/*.test.ts   (vitest.config.mts)
// Un fichier de tests/ nomme *.test.<autre extension> n est lu par AUCUN
// executeur : il ne rougit jamais, ne tourne jamais, et sa presence dans l
// arbre se lit comme une couverture. Le defaut est SILENCIEUX — la famille
// exacte que ce dossier existe pour attraper (le faux positif visible prefere
// au faux negatif silencieux).
//
// `stale-path-citations.test.ts` guette les CITATIONS d un ancien nom de
// fichier ; celui-ci guette la PRESENCE d un fichier qu aucun executeur ne lira.
//
// Meme famille que ses voisins de `tests/repo/` : il lit le vrai disque, ce
// n est pas un test unitaire (cf. `tests/CLAUDE.md` § 4).
import { expect, test } from 'vitest';
import { readdirSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');

// Ce que vitest sait lire. Toute extension ajoutee ici doit D ABORD entrer
// dans son motif (`include` de vitest.config.mts) — l inverse rendrait ce
// filet menteur.
const EXTENSIONS_LUES = new Set(['.ts']);

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
const EXCEPTIONS = new Map<string, string>([]);

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

test('tout fichier *.test.* ou *.spec.* sous tests/ porte une extension que vitest lit', () => {
  // Arrange
  const tous = fichiersDeTest();

  // Act
  const invisibles = tous.filter(rel => !EXTENSIONS_LUES.has(path.extname(rel)));

  // Assert — l assiette est dite AVANT le verdict : un balayage qui ne voit
  // rien passerait aussi, et ne prouverait rien.
  expect(tous.length >= 100, `assiette suspecte : ${tous.length} fichiers de test vus, attendu >= 100`).toBeTruthy();
  expect(invisibles, 'ce fichier n est lu par AUCUN executeur (vitest ne lit que .test.ts) : ' +
      'il ne tournera jamais, vert par absence. ' +
      'Le renommer vers une extension lue, ou etendre le motif de vitest ET ce filet ensemble.').toEqual([]);
});

test('aucun fichier *.test.* ou *.spec.* hors de tests/, sauf sous une exception nommee', () => {
  // Arrange
  const horsDeTests = fichiersDeTestHorsDeTests();

  // Act
  const nonCouverts = horsDeTests.filter(rel => !couvertParUneException(rel));

  // Assert
  expect(nonCouverts, 'vitest ne lit que tests/ : ce fichier ne tournera jamais. ' +
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

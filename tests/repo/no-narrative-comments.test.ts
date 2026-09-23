// Un commentaire dit POURQUOI le code est ainsi, au présent. Ce filet refuse le récit
// dans les commentaires de `src`, `bin`, `tests`, `test-support` et `vitest.config.mts` :
// une date, un document numéroté, une étape de chantier, une traduction du mot hook.
//
// Ce filet n'est PAS un test unitaire (il lit le vrai disque, cf. `tests/CLAUDE.md` § 4) :
// c'est une vérification d'hygiène du dépôt, d'où `tests/repo/` — même famille que
// `stale-path-citations.test.ts` et `documentation-citations.test.ts`.
//
// Deux règles, lues sur ce que `tests/helpers/comment-lines.ts` reconnaît comme commentaire :
//   1. aucune ligne de commentaire ne porte un des marqueurs de MOTIFS ;
//   2. aucun bloc de commentaire ne dépasse LIMITE_BLOC lignes — au-delà, un bloc raconte.
//
// Une donnée datée qui n'est pas un récit, comme la date à laquelle un tarif change, entre
// dans LISTE_BLANCHE avec sa raison ; une entrée qui ne couvre plus rien est ROUGE, sans quoi
// elle couvrirait un jour un récit neuf.
import { expect, test } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { commentPart, commentBlocks } from '../helpers/comment-lines.ts';

const ROOT = path.resolve(import.meta.dirname, '..', '..');

const ARBRES = ['src', 'bin', 'tests', 'test-support'];
// Les fichiers de configuration de la racine ne sont sous aucun des ARBRES : sans cette
// liste, ils ne sont jamais lus.
const FICHIERS_RACINE = ['vitest.config.mts'];
const DOSSIERS_IGNORES = new Set(['node_modules', '.git', 'dist']);
const EXTENSIONS = new Set(['.ts', '.mts', '.js', '.mjs', '.cjs', '.css', '.html']);

const LIMITE_BLOC = 30;
// Plancher d'assiette : le balayage lit aujourd'hui bien plus de lignes de commentaire que
// ce nombre. Un balayage cassé en lirait zéro et laisserait les deux règles vertes.
const PLANCHER_LIGNES = 6000;

// Chaque motif est un morceau d'expression régulière. Le mot français qui traduit hook
// s'écrit en deux morceaux : ainsi une recherche de ce mot dans le dépôt ne tombe pas sur
// le filet qui le refuse.
const MOTIFS = [
  String.raw`\d{4}-\d{2}-\d{2}`,
  String.raw`doc\/\d+`,
  String.raw`[ée]tapes?\s+\d+`,
  String.raw`lots?\s+\d+`,
  String.raw`t[âa]ches?\s+\d+`,
  String.raw`steps?\s+\d+`,
  'cro' + 'chets?',
];

// Un marqueur ne compte qu'au début d'un mot : le mot `lot` pris dans `slot` ne déclenche rien.
const MARQUEUR = new RegExp(MOTIFS.map((m) => String.raw`(?<![\p{L}\p{N}_])` + m).join('|'), 'iu');

// La détection, une seule, partagée par le balayage réel et par le contrôle négatif : le
// marqueur trouvé dans la part commentée de la ligne, ou `null`.
export function marqueurDeRecit(ligne: string) {
  const trouve = commentPart(ligne).match(MARQUEUR);
  return trouve ? trouve[0] : null;
}

export function blocsTropLongs(lignes: string[], limite = LIMITE_BLOC) {
  return commentBlocks(lignes).filter((b) => b.length > limite);
}

// ── La liste blanche des données datées ──────────────────────────────────────
//
// Une entrée = { fichier, fragment, raison }. Une ligne est couverte si son fichier porte
// une entrée dont le `fragment` est contenu dans la ligne. Le fragment, et non le numéro de
// ligne : un numéro se périme au premier ajout au-dessus.
const LISTE_BLANCHE = [
  {
    fichier: 'tests/audit/d1-clones.test.ts',
    fragment: "l'étape 2 regroupe sur la séquence de jetons",
    raison: "« étape 2 » nomme une étape de l'algorithme du détecteur de clones, pas une étape de chantier : c'est le mécanisme que ce test décrit",
  },
  {
    fichier: 'tests/audit/verite-terrain.test.ts',
    fragment: 'établis À LA MAIN le',
    raison: "la date du relevé à la main est la donnée qui identifie le jeu de référence auquel ce test compare les détecteurs",
  },
];

function fichiersBalayes() {
  const acc = [];
  const marche = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!DOSSIERS_IGNORES.has(e.name)) marche(abs);
      } else if (EXTENSIONS.has(path.extname(e.name))) {
        acc.push(path.relative(ROOT, abs).replaceAll('\\', '/'));
      }
    }
  };
  for (const arbre of ARBRES) marche(path.join(ROOT, arbre));
  for (const fichier of FICHIERS_RACINE) acc.push(fichier);
  return acc;
}

const lignesDe = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8').split(/\r?\n/);

type Occurrence = { fichier: string; ligne: number; marqueur: string; texte: string };
type EntreeBlanche = { fichier: string; fragment: string; raison: string };

function lignesDeRecit() {
  const trouvees: Occurrence[] = [];
  for (const rel of fichiersBalayes()) {
    lignesDe(rel).forEach((ligne, i) => {
      const marqueur = marqueurDeRecit(ligne);
      if (marqueur) trouvees.push({ fichier: rel, ligne: i + 1, marqueur, texte: ligne.trim() });
    });
  }
  return trouvees;
}

const couvertePar = (occ: Occurrence, liste: EntreeBlanche[] = LISTE_BLANCHE) =>
  liste.find((e) => e.fichier === occ.fichier && occ.texte.includes(e.fragment));

const orphelinesDe = (liste: EntreeBlanche[], vues: Occurrence[]) => liste.filter((e) => !vues.some((o) => couvertePar(o, [e])));

// ── L'instrument prouve qu'il mord ───────────────────────────────────────────
test('une ligne de commentaire fabriquée qui renvoie à une étape numérotée est refusée', () => {
  // Arrange — le commentaire s'écrit en deux morceaux : écrit en clair, il ferait
  // refuser ce fichier-ci par le balayage réel.
  const fabriquee = '  ' + '/' + '/ suite de la ' + 'étape 3, voir doc' + '/49';

  // Act
  const marqueur = marqueurDeRecit(fabriquee);

  // Assert
  expect(marqueur, `la ligne fabriquée ${JSON.stringify(fabriquee)} doit être refusée par MARQUEUR`).toBe('étape 3');
});

test('un bloc fabriqué de plus de trente lignes est vu, un bloc de trente lignes passe', () => {
  // Arrange
  const bloc = (n: number) => Array.from({ length: n }, () => '/' + '/ une ligne de commentaire');
  const lignes = [...bloc(LIMITE_BLOC), 'const x = 1;', ...bloc(LIMITE_BLOC + 1)];

  // Act
  const longs = blocsTropLongs(lignes);

  // Assert
  expect(longs).toEqual([{ line: LIMITE_BLOC + 2, length: LIMITE_BLOC + 1 }]);
});

// ── Le balayage réel ─────────────────────────────────────────────────────────
test('le balayage lit des fichiers et un plancher de lignes de commentaire', () => {
  // Arrange
  const fichiers = fichiersBalayes();

  // Act
  const lignesCommentees = fichiers.reduce(
    (total, rel) => total + lignesDe(rel).filter((l) => commentPart(l) !== '').length,
    0,
  );

  // Assert
  expect(lignesCommentees >= PLANCHER_LIGNES, `assiette suspecte : ${lignesCommentees} lignes de commentaire lues dans ${fichiers.length} fichiers, attendu au moins ${PLANCHER_LIGNES} — le balayage ne lit plus le dépôt`).toBeTruthy();
});

test('aucun commentaire ne renvoie à une date, un document numéroté ou une étape, hors liste blanche', () => {
  // Arrange
  const toutes = lignesDeRecit();

  // Act
  const refusees = toutes.filter((o) => !couvertePar(o));

  // Assert
  expect(refusees.map((o) => `${o.fichier}:${o.ligne} [${o.marqueur}] ${o.texte}`), "un commentaire dit pourquoi le code est ainsi, au présent : le réécrire sans le renvoi ni la date. "
      + "Si le marqueur est une DONNÉE (une date à laquelle un tarif change, par exemple) et non un récit, "
      + "inscrire la ligne dans LISTE_BLANCHE avec son fichier, un fragment de la ligne et sa raison.").toEqual([]);
});

test('chaque entrée de la liste blanche couvre encore une ligne datée', () => {
  // Arrange
  const toutes = lignesDeRecit();

  // Act
  const orphelines = orphelinesDe(LISTE_BLANCHE, toutes);

  // Assert
  expect(orphelines.map((e) => `${e.fichier} → ${e.fragment}`), "une entrée de liste blanche sans ligne à couvrir a survécu à ce qu'elle protégeait : la retirer, "
      + "sinon elle couvrira un jour un commentaire neuf.").toEqual([]);
});

test('aucun bloc de commentaire ne dépasse trente lignes', () => {
  // Arrange
  const fichiers = fichiersBalayes();

  // Act
  const longs = fichiers.flatMap((rel) => blocsTropLongs(lignesDe(rel)).map((b) => `${rel}:${b.line} (${b.length} lignes)`));

  // Assert
  expect(longs, `un bloc de commentaire de plus de ${LIMITE_BLOC} lignes raconte au lieu d'expliquer : garder une idée par paragraphe, trois lignes par idée, et nommer le test qui tient ce que le bloc affirme.`).toEqual([]);
});

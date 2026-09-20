// Rien ne garde les comptes de fichiers de test qu'ARCHITECTURE.md § 9
// affiche : ce filet les derive du disque, sous `tests/` seulement, et
// rougit en nommant l'ecart des que le document et le disque divergent.
import { expect, test } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');

// Un `null` distingue « le motif ne mord plus » de « le compte vaut 0 » :
// un motif mort et un compte juste sont deux pannes differentes.
export function parseComptesDoc(texte: string) {
  const total = texte.match(/(\d+)\s*`\.test\.ts`/);
  if (!total) return null;
  return { ts: Number(total[1]) };
}

function ligneContenant(texte: string, sousChaine: string) {
  return texte.split(/\r?\n/).find((l: string) => l.includes(sousChaine)) ?? null;
}

// Les deux autres nombres du paragraphe : le total de fichiers, ecrit deux fois
// (titre du § 9 et sortie vitest du § 9). Le document n'ecrit pas de nombre de
// TESTS : il ne se derive pas du disque.
export function parseComptesEtendusDoc(texte: string) {
  const ligneTitre = ligneContenant(texte, 'un seul arbre de tests');
  const ligneVitest = ligneContenant(texte, 'npx vitest run');
  if (!ligneTitre || !ligneVitest) return null;
  const mTitre = ligneTitre.match(/dans\s+(\d+)\s+fichiers/);
  const mVitest = ligneVitest.match(/,\s*(\d+)\s*fichiers/);
  if (!mTitre || !mVitest) return null;
  return { totalTitre: Number(mTitre[1]), totalVitest: Number(mVitest[1]) };
}

export function compterDisque(root: string) {
  let ts = 0;
  const marcher = (dir: string) => {
    for (const entree of readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entree.name);
      if (entree.isDirectory()) { marcher(abs); continue; }
      if (entree.name.endsWith('.test.ts')) ts++;
    }
  };
  marcher(path.join(root, 'tests'));
  return { ts };
}

// ── Verificateurs purs : ce qui a bouge, NOMME ──────────────────────────────
export function ecartsComptes(doc: { ts: number }, disque: { ts: number }) {
  const ecarts = [];
  if (doc.ts !== disque.ts) {
    ecarts.push(`.test.ts : ARCHITECTURE.md dit ${doc.ts}, le disque en a ${disque.ts}`);
  }
  return ecarts;
}

export function ecartsComptesEtendus(
  doc: { totalTitre: number; totalVitest: number },
  totalDisque: number,
) {
  const ecarts = [];
  if (doc.totalTitre !== totalDisque) {
    ecarts.push(`titre du § 9 : ARCHITECTURE.md dit ${doc.totalTitre} fichiers, le disque en a ${totalDisque}`);
  }
  if (doc.totalVitest !== totalDisque) {
    ecarts.push(`sortie vitest du § 9 : ARCHITECTURE.md dit ${doc.totalVitest} fichiers, le disque en a ${totalDisque}`);
  }
  return ecarts;
}

// ── L'instrument prouve qu'il mord (cas rouges a demeure) ───────────────────
test('le verificateur signale un compte qui a bouge, en le nommant', () => {
  const ecarts = ecartsComptes({ ts: 30 }, { ts: 31 });
  expect(ecarts.length).toBe(1);
  expect(ecarts[0]).toMatch(/\.test\.ts : ARCHITECTURE\.md dit 30, le disque en a 31/);
});

test('le verificateur accepte quand le compte coincide', () => {
  const ecarts = ecartsComptes({ ts: 30 }, { ts: 30 });
  expect(ecarts).toEqual([]);
});

test('le verificateur etendu signale le titre et la sortie vitest du § 9 separement, chacun nomme', () => {
  const doc = { totalTitre: 100, totalVitest: 101 };
  const ecarts = ecartsComptesEtendus(doc, 100);
  expect(ecarts).toEqual([
    'sortie vitest du § 9 : ARCHITECTURE.md dit 101 fichiers, le disque en a 100',
  ]);
});

test('le verificateur etendu accepte quand les deux nombres coincident', () => {
  const ecarts = ecartsComptesEtendus({ totalTitre: 100, totalVitest: 100 }, 100);
  expect(ecarts).toEqual([]);
});

// ── Le controle reel ─────────────────────────────────────────────────────
const texteDoc = readFileSync(path.join(ROOT, 'ARCHITECTURE.md'), 'utf8');
const docParse = parseComptesDoc(texteDoc);
const docParseEtendu = parseComptesEtendusDoc(texteDoc);
const disque = compterDisque(ROOT);

test('assiette : le compte se lit, et le disque porte des fichiers de test', () => {
  expect(docParse !== null, 'le motif de lecture du compte `.test.ts` ne trouve plus rien dans ARCHITECTURE.md').toBeTruthy();
  expect(docParseEtendu !== null, 'le motif de lecture du titre et de la sortie vitest du § 9 ne trouve plus rien dans ARCHITECTURE.md').toBeTruthy();
  expect(disque.ts > 0, `assiette suspecte : ${JSON.stringify(disque)}`).toBeTruthy();
});

test('le compte de fichiers `.test.ts` que porte ARCHITECTURE.md § 9 suit le disque', () => {
  const ecarts = ecartsComptes(docParse!, disque);
  expect(ecarts, 'ARCHITECTURE.md § 9 a gele pendant que le disque bougeait :\n  ' + ecarts.join('\n  ')).toEqual([]);
});

test('le total de fichiers (titre et sortie vitest du § 9) suit le disque', () => {
  const ecarts = ecartsComptesEtendus(docParseEtendu!, disque.ts);
  expect(ecarts, 'ARCHITECTURE.md § 9 a gele pendant que le disque bougeait :\n  ' + ecarts.join('\n  ')).toEqual([]);
});

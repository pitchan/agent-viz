// Rien ne garde les comptes de fichiers de test qu'ARCHITECTURE.md § 9
// affiche : ce filet les derive du disque, sous `tests/` seulement, et
// rougit en nommant l'ecart des que le document et le disque divergent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');

// Un `null` distingue « le motif ne mord plus » de « le compte vaut 0 » :
// un motif mort et un compte juste sont deux pannes differentes.
export function parseComptesDoc(texte) {
  const dialecte = texte.match(/(\d+)\s*`\.test\.cjs`\s*\+\s*(\d+)\s*`\.test\.mjs`/);
  const ts = texte.match(/(\d+)\s*`\.test\.ts`/);
  if (!dialecte || !ts) return null;
  return { cjs: Number(dialecte[1]), mjs: Number(dialecte[2]), ts: Number(ts[1]) };
}

function ligneContenant(texte, sousChaine) {
  return texte.split(/\r?\n/).find((l) => l.includes(sousChaine)) ?? null;
}

// Les deux autres nombres du paragraphe : le total de fichiers (titre du § 9
// et sortie vitest du § 9) et le compte rendu par la commande grep du § 9. Le
// document n'ecrit pas de nombre de TESTS : il ne se derive pas du disque.
export function parseComptesEtendusDoc(texte) {
  const ligneTitre = ligneContenant(texte, 'un seul arbre de tests');
  const ligneVitest = ligneContenant(texte, 'npx vitest run');
  const ligneGrep = ligneContenant(texte, 'tests | wc -l');
  if (!ligneTitre || !ligneVitest || !ligneGrep) return null;
  const mTitre = ligneTitre.match(/dans\s+(\d+)\s+fichiers/);
  const mVitest = ligneVitest.match(/,\s*(\d+)\s*fichiers/);
  const mGrep = ligneGrep.match(/→\s*(\d+)/);
  if (!mTitre || !mVitest || !mGrep) return null;
  return { totalTitre: Number(mTitre[1]), totalVitest: Number(mVitest[1]), importsGrep: Number(mGrep[1]) };
}

export function compterDisque(root) {
  const compte = { cjs: 0, mjs: 0, ts: 0 };
  const marcher = (dir) => {
    for (const entree of readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entree.name);
      if (entree.isDirectory()) { marcher(abs); continue; }
      if (entree.name.endsWith('.test.cjs')) compte.cjs++;
      else if (entree.name.endsWith('.test.mjs')) compte.mjs++;
      else if (entree.name.endsWith('.test.ts')) compte.ts++;
    }
  };
  marcher(path.join(root, 'tests'));
  return compte;
}

// Meme motif que la commande grep du § 9, applique au contenu de chaque fichier
// sous `tests/` (aucun filtre d'extension : la commande n'en pose pas non
// plus — un fichier hors dialecte connu qui importerait node:test compterait).
export function compterImportsNodeTest(root) {
  const motif = /(require\(|from )['"]node:test['"]/;
  let compte = 0;
  const marcher = (dir) => {
    for (const entree of readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entree.name);
      if (entree.isDirectory()) { marcher(abs); continue; }
      if (motif.test(readFileSync(abs, 'utf8'))) compte++;
    }
  };
  marcher(path.join(root, 'tests'));
  return compte;
}

// ── Verificateurs purs : ce qui a bouge, NOMME ──────────────────────────────
export function ecartsComptes(doc, disque) {
  const ecarts = [];
  for (const cle of ['cjs', 'mjs', 'ts']) {
    if (doc[cle] !== disque[cle]) {
      ecarts.push(`.test.${cle} : ARCHITECTURE.md dit ${doc[cle]}, le disque en a ${disque[cle]}`);
    }
  }
  return ecarts;
}

export function ecartsComptesEtendus(doc, totalDisque, importsDisque) {
  const ecarts = [];
  if (doc.totalTitre !== totalDisque) {
    ecarts.push(`titre du § 9 : ARCHITECTURE.md dit ${doc.totalTitre} fichiers, le disque en a ${totalDisque}`);
  }
  if (doc.totalVitest !== totalDisque) {
    ecarts.push(`sortie vitest du § 9 : ARCHITECTURE.md dit ${doc.totalVitest} fichiers, le disque en a ${totalDisque}`);
  }
  if (doc.importsGrep !== importsDisque) {
    ecarts.push(`commande grep du § 9 : ARCHITECTURE.md dit ${doc.importsGrep}, le disque en a ${importsDisque}`);
  }
  return ecarts;
}

// ── L'instrument prouve qu'il mord (cas rouges a demeure) ───────────────────
test('le verificateur signale un compte qui a bouge, en le nommant', () => {
  const ecarts = ecartsComptes({ cjs: 10, mjs: 20, ts: 30 }, { cjs: 10, mjs: 21, ts: 30 });
  assert.equal(ecarts.length, 1);
  assert.match(ecarts[0], /\.test\.mjs : ARCHITECTURE\.md dit 20, le disque en a 21/);
});

test('le verificateur accepte quand les trois comptes coincident', () => {
  const ecarts = ecartsComptes({ cjs: 10, mjs: 20, ts: 30 }, { cjs: 10, mjs: 20, ts: 30 });
  assert.deepEqual(ecarts, []);
});

test('le verificateur etendu signale le titre, la sortie vitest et la commande grep du § 9 separement, chacun nomme', () => {
  const doc = { totalTitre: 100, totalVitest: 101, importsGrep: 50 };
  const ecarts = ecartsComptesEtendus(doc, 100, 93);
  assert.deepEqual(ecarts, [
    'sortie vitest du § 9 : ARCHITECTURE.md dit 101 fichiers, le disque en a 100',
    'commande grep du § 9 : ARCHITECTURE.md dit 50, le disque en a 93',
  ]);
});

test('le verificateur etendu accepte quand les trois nombres coincident', () => {
  const ecarts = ecartsComptesEtendus({ totalTitre: 100, totalVitest: 100, importsGrep: 93 }, 100, 93);
  assert.deepEqual(ecarts, []);
});

// ── Le controle reel ─────────────────────────────────────────────────────
const texteDoc = readFileSync(path.join(ROOT, 'ARCHITECTURE.md'), 'utf8');
const docParse = parseComptesDoc(texteDoc);
const docParseEtendu = parseComptesEtendusDoc(texteDoc);
const disque = compterDisque(ROOT);
const totalDisque = disque.cjs + disque.mjs + disque.ts;
const importsDisque = compterImportsNodeTest(ROOT);

test('assiette : les deux tableaux se lisent, et le disque porte des fichiers de test', () => {
  assert.ok(docParse !== null, 'le motif de lecture du tableau « Dialecte » ne trouve plus rien dans ARCHITECTURE.md');
  assert.ok(docParseEtendu !== null, 'le motif de lecture du titre, de la sortie vitest et de la commande grep du § 9 ne trouve plus rien dans ARCHITECTURE.md');
  // `cjs` peut légitimement valoir 0 : le dépôt ne porte plus aucun `.test.cjs`.
  // `mjs`, `ts` et les imports node:test restent la vraie garde contre une
  // assiette qui lirait un dossier vide.
  assert.ok(disque.cjs >= 0 && disque.mjs > 0 && disque.ts > 0 && importsDisque > 0,
    `assiette suspecte : ${JSON.stringify(disque)}, imports=${importsDisque}`);
});

test('les trois comptes de tests que porte ARCHITECTURE.md § 9 suivent le disque', () => {
  const ecarts = ecartsComptes(docParse, disque);
  assert.deepEqual(
    ecarts,
    [],
    'ARCHITECTURE.md § 9 a gele pendant que le disque bougeait :\n  ' + ecarts.join('\n  '),
  );
});

test('le total de fichiers (titre et sortie vitest du § 9) et le compte d\'imports node:test (commande grep du § 9) suivent le disque', () => {
  const ecarts = ecartsComptesEtendus(docParseEtendu, totalDisque, importsDisque);
  assert.deepEqual(
    ecarts,
    [],
    'ARCHITECTURE.md § 9 a gele pendant que le disque bougeait :\n  ' + ecarts.join('\n  '),
  );
});

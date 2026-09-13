// La vraie cause de la derive constatee tache 6 (doc/49) : rien dans le depot
// ne garde les trois comptes que le paragraphe 9 d'ARCHITECTURE.md affiche
// (fichiers `.test.cjs`, `.test.mjs`, `.test.ts` sous `tests/`). Le tableau
// etait exact quand il a ete ecrit puis a gele, pendant que deux chantiers
// deplacaient les comptes en sens contraire sans qu'aucune commande ne rougisse.
//
// Ce filet DERIVE les trois comptes du disque, sous `tests/` seulement (jamais
// `docs/audit/scripts/`, qu'aucun executeur ne lance), et les compare a ce
// qu'ARCHITECTURE.md affirme. Meme famille que `documentation-citations.test.mjs`
// et `stale-path-citations.test.mjs` : une verification d'hygiene du depot, pas
// un test unitaire (elle lit le vrai disque), d'ou `tests/repo/`.
//
// CE QUE CE FILET NE PROUVE PAS : que le total « fichiers en node:test » ou
// que l'addition du bas du § 9 est juste — ce sont des DERIVATIONS ARITHMETIQUES
// des deux premiers comptes (cjs + mjs), pas des comptes independants ; les
// suivre demanderait de reparser un second fragment de prose pour verifier une
// addition, ce qui n'ajoute aucune garantie a ce que ce filet etablit deja.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');

// ── Ce qu'ARCHITECTURE.md affirme, extrait de son tableau « Dialecte » ──────
// Un `null` en cas d'echec de lecture, distingue de "0" : un motif qui ne
// mord plus se voit, il ne se lit pas comme un compte juste par accident.
export function parseComptesDoc(texte) {
  const dialecte = texte.match(/(\d+)\s*`\.test\.cjs`\s*\+\s*(\d+)\s*`\.test\.mjs`/);
  const ts = texte.match(/(\d+)\s*`\.test\.ts`/);
  if (!dialecte || !ts) return null;
  return { cjs: Number(dialecte[1]), mjs: Number(dialecte[2]), ts: Number(ts[1]) };
}

// ── Ce que le disque contient reellement, sous `tests/` seulement ──────────
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

// ── Verificateur pur : ce qui a bouge, NOMME ────────────────────────────────
export function ecartsComptes(doc, disque) {
  const ecarts = [];
  for (const cle of ['cjs', 'mjs', 'ts']) {
    if (doc[cle] !== disque[cle]) {
      ecarts.push(`.test.${cle} : ARCHITECTURE.md dit ${doc[cle]}, le disque en a ${disque[cle]}`);
    }
  }
  return ecarts;
}

// ── L'instrument prouve qu'il mord (cas rouge a demeure) ────────────────────
test('le verificateur signale un compte qui a bouge, en le nommant', () => {
  const ecarts = ecartsComptes({ cjs: 10, mjs: 20, ts: 30 }, { cjs: 10, mjs: 21, ts: 30 });
  assert.equal(ecarts.length, 1);
  assert.match(ecarts[0], /\.test\.mjs : ARCHITECTURE\.md dit 20, le disque en a 21/);
});

test('le verificateur accepte quand les trois comptes coincident', () => {
  const ecarts = ecartsComptes({ cjs: 10, mjs: 20, ts: 30 }, { cjs: 10, mjs: 20, ts: 30 });
  assert.deepEqual(ecarts, []);
});

// ── Le controle reel ─────────────────────────────────────────────────────
const texteDoc = readFileSync(path.join(ROOT, 'ARCHITECTURE.md'), 'utf8');
const docParse = parseComptesDoc(texteDoc);
const disque = compterDisque(ROOT);

test('assiette : le tableau du § 9 se lit, et le disque porte des fichiers de test', () => {
  // Un motif qui ne mord plus rendrait `null`, et un `null` compare a un
  // nombre serait TOUJOURS inegal : ca rougirait, mais pour la mauvaise raison.
  // On le nomme a part pour que le rouge dise « le motif a cesse de mordre »,
  // pas « les comptes ont bouge ».
  assert.ok(docParse !== null, 'le motif de lecture du tableau « Dialecte » ne trouve plus rien dans ARCHITECTURE.md');
  assert.ok(disque.cjs > 0 && disque.mjs > 0 && disque.ts > 0,
    `assiette suspecte : ${JSON.stringify(disque)}`);
});

test('les trois comptes de tests que porte ARCHITECTURE.md § 9 suivent le disque', () => {
  const ecarts = ecartsComptes(docParse, disque);
  assert.deepEqual(
    ecarts,
    [],
    'ARCHITECTURE.md § 9 a gele pendant que le disque bougeait :\n  ' + ecarts.join('\n  '),
  );
});

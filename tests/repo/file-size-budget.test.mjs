// Garde-fou de taille de fichier (doc/43 du dépôt privé, décision du 2026-08-19).
// Le seuil ne mesure PAS la responsabilité unique — la liste ASSUMED l'assume,
// avec une raison écrite par entrée. Deux règles font du test un cliquet :
//   1. un fichier de src/ au-dessus du budget et absent d'ASSUMED → échec ;
//   2. une entrée d'ASSUMED repassée sous le budget (ou disparue) → échec
//      (« entrée périmée ») — la liste se resserre, elle ne s'accumule pas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BUDGET = 450; // lignes (au sens wc -l : nombre de \n)

// Assiette du 2026-08-19 (fichiers > 450 lignes ce jour-là), une raison par entrée.
const ASSUMED = new Map([
  ['src/server/install-hooks.ts', 'découpage en cours (doc/43 privé) — DOIT sortir de cette liste à la fin du chantier'],
  ['src/web/viz-ui.js',           'fourre-tout identifié — découpage décidé post-étape 5 (2026-08-19)'],
  ['src/web/viz-watchdog.mjs',    'registre DETECTORS cohésif : la taille = le nombre de détecteurs'],
  ['src/engine/map/env.ts',       'un seul algorithme (AST des variables d\'environnement), un seul export public'],
  ['src/web/viz-layout.js',       'deux métiers (état + géométrie) — découpage décidé post-étape 5 (2026-08-19)'],
  ['src/engine/map/routes.ts',    'assiette 2026-08-19 — dette constatée, non auditée'],
  ['src/web/viz-canvas.js',       'dessin du nœud — responsabilité établie (docs/audit-qualite-code.md § sain)'],
  ['src/server/transcript.ts',    'assiette 2026-08-19 — dette constatée, non auditée'],
]);

// ── Vérificateur pur ──
// entries: Array<{ file: string, lines: number }> ; assumed: Map<file, raison>
// Rend la liste des violations (chaînes lisibles) ; [] = conforme.
export function checkBudget(entries, budget, assumed) {
  const violations = [];
  const seen = new Set();
  for (const { file, lines } of entries) {
    seen.add(file);
    if (lines > budget && !assumed.has(file)) {
      violations.push(
        `${file} : ${lines} lignes > ${budget}. Découper (une responsabilité par fichier), `
        + `OU l'inscrire dans ASSUMED avec une raison écrite.`,
      );
    }
    if (lines <= budget && assumed.has(file)) {
      violations.push(
        `entrée périmée : ${file} (${lines} lignes) est repassé sous ${budget} — la retirer d'ASSUMED.`,
      );
    }
  }
  for (const file of assumed.keys()) {
    if (!seen.has(file)) violations.push(`entrée périmée : ${file} n'existe plus — la retirer d'ASSUMED.`);
  }
  return violations;
}

function countLines(content) {
  return (content.match(/\n/g) || []).length;
}

function scanSrc() {
  const entries = [];
  for (const rel of fs.readdirSync(path.join(ROOT, 'src'), { recursive: true })) {
    const p = String(rel).replace(/\\/g, '/');
    if (!/\.(ts|js|mjs)$/.test(p)) continue;
    const abs = path.join(ROOT, 'src', String(rel));
    if (!fs.statSync(abs).isFile()) continue;
    entries.push({ file: `src/${p}`, lines: countLines(fs.readFileSync(abs, 'utf8')) });
  }
  return entries;
}

// ── L'instrument prouve qu'il mord (cas rouges à demeure) ──
test('le vérificateur signale un dépassement non listé', () => {
  const got = checkBudget([{ file: 'src/x.ts', lines: 451 }], 450, new Map());
  assert.equal(got.length, 1);
  assert.match(got[0], /451 lignes > 450/);
});

test('le vérificateur signale une entrée périmée (repassée sous le budget)', () => {
  const got = checkBudget([{ file: 'src/x.ts', lines: 10 }], 450, new Map([['src/x.ts', 'raison']]));
  assert.equal(got.length, 1);
  assert.match(got[0], /entrée périmée/);
});

test('le vérificateur signale une entrée périmée (fichier disparu)', () => {
  const got = checkBudget([], 450, new Map([['src/gone.ts', 'raison']]));
  assert.equal(got.length, 1);
  assert.match(got[0], /n'existe plus/);
});

test('le vérificateur accepte un dépassement assumé et un fichier sous budget', () => {
  const got = checkBudget(
    [{ file: 'src/big.ts', lines: 900 }, { file: 'src/ok.ts', lines: 100 }],
    450, new Map([['src/big.ts', 'raison écrite']]),
  );
  assert.deepEqual(got, []);
});

// ── Le balayage réel ──
test('src/ respecte le budget de taille de fichier (450 lignes, exceptions assumées)', () => {
  const violations = checkBudget(scanSrc(), BUDGET, ASSUMED);
  assert.deepEqual(violations, [], `\n${violations.join('\n')}`);
});

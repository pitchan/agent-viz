// Garde-fou de taille de fichier.
// Le seuil ne mesure PAS la responsabilité unique — LISTE_BLANCHE en répond,
// avec une raison écrite par entrée. Deux règles font du test un cliquet :
//   1. un fichier de src/ ou bin/ au-dessus du budget et absent de LISTE_BLANCHE → échec ;
//   2. une entrée de LISTE_BLANCHE repassée sous le budget (ou disparue) → échec
//      (« entrée périmée ») — la liste se resserre, elle ne s'accumule pas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BUDGET = 450; // lignes (au sens wc -l : nombre de \n)

// Les fichiers de src/ et bin/ admis au-dessus du budget, une raison écrite par entrée.
const LISTE_BLANCHE = new Map([
  ['src/web/viz-ui.ts',
    "Tous les panneaux du tableau de bord tiennent dans ce fichier : fil d'événements, fiche de détail, "
    + "pastilles de budget et d'alertes, compteurs, raccourcis clavier, notifications. Chaque panneau "
    + "change pour sa propre raison ; c'est une dette."],
  ['src/engine/watchdog/detector.ts',
    "Un seul métier : détecter les motifs toxiques dans le flux d'événements. La table des détecteurs "
    + "et la fabrique qui les fait tourner partagent le même état de session ; ajouter un détecteur "
    + "ajoute une entrée à la table, et le fichier grossit d'autant."],
  ['src/web/viz-layout.ts',
    "Deux métiers dans un fichier : transformer chaque événement hook en nœuds du graphe (création, "
    + "parenté, fin), et placer ces nœuds en orbite autour de leur parent. Chaque métier change pour "
    + "sa propre raison ; c'est une dette."],
  ['src/web/viz-canvas.ts',
    "Un seul métier : la toile où le graphe s'affiche — sa taille à l'écran, la caméra (déplacement "
    + "et zoom), le nœud sous la souris, les particules et la boucle qui repeint. Le dessin de chaque "
    + "nœud vit dans viz-drawers.ts ; tout ce qui reste ici se calcule dans le même repère de caméra."],
  ['src/server/transcript.ts',
    "Deux métiers dans un fichier : retrouver le premier message de l'utilisateur dans le transcript "
    + "de la session, et suivre le transcript qui grossit (celui de la session et ceux de ses "
    + "sous-agents) pour en tirer les jetons consommés. Chaque métier a son propre consommateur dans "
    + "le serveur ; c'est une dette."],
  ['bin/agent-viz.js',
    "Le point d'entrée de la ligne de commande : il lit les options, vérifie que le code compilé est "
    + "présent et à jour, charge le module de dist/ concerné et affiche le résultat. La logique vit "
    + "dans dist/ ; ici, une fonction par sous-commande, et le fichier grossit avec le nombre de "
    + "sous-commandes et de leurs options."],
]);

// ── Vérificateur pur ──
// entries: Array<{ file: string, lines: number }> ; listeBlanche: Map<file, raison>
// Rend la liste des violations (chaînes lisibles) ; [] = conforme.
export function checkBudget(entries, budget, listeBlanche) {
  const violations = [];
  const seen = new Set();
  for (const { file, lines } of entries) {
    seen.add(file);
    if (lines > budget && !listeBlanche.has(file)) {
      violations.push(
        `${file} : ${lines} lignes > ${budget}. Découper (une responsabilité par fichier), `
        + `OU l'inscrire dans LISTE_BLANCHE avec une raison écrite.`,
      );
    }
    if (lines <= budget && listeBlanche.has(file)) {
      violations.push(
        `entrée périmée : ${file} (${lines} lignes) est repassé sous ${budget} — la retirer de LISTE_BLANCHE.`,
      );
    }
  }
  for (const file of listeBlanche.keys()) {
    if (!seen.has(file)) violations.push(`entrée périmée : ${file} n'existe plus — la retirer de LISTE_BLANCHE.`);
  }
  return violations;
}

function countLines(content) {
  return (content.match(/\n/g) || []).length;
}

// bin/ est balayé comme src/ : le binaire est du code livré au même titre.
const DOSSIERS = ['src', 'bin'];

function scanRepo() {
  const entries = [];
  for (const dossier of DOSSIERS) {
    for (const rel of fs.readdirSync(path.join(ROOT, dossier), { recursive: true })) {
      const p = String(rel).replace(/\\/g, '/');
      if (!/\.(ts|js|mjs)$/.test(p)) continue;
      const abs = path.join(ROOT, dossier, String(rel));
      if (!fs.statSync(abs).isFile()) continue;
      entries.push({ file: `${dossier}/${p}`, lines: countLines(fs.readFileSync(abs, 'utf8')) });
    }
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

test('le vérificateur accepte un dépassement inscrit avec sa raison et un fichier sous budget', () => {
  const got = checkBudget(
    [{ file: 'src/big.ts', lines: 900 }, { file: 'src/ok.ts', lines: 100 }],
    450, new Map([['src/big.ts', 'raison écrite']]),
  );
  assert.deepEqual(got, []);
});

// ── Le balayage réel ──
test('src/ et bin/ respectent le budget de taille de fichier (450 lignes, exceptions inscrites avec leur raison)', () => {
  const violations = checkBudget(scanRepo(), BUDGET, LISTE_BLANCHE);
  assert.deepEqual(violations, [], `\n${violations.join('\n')}`);
});

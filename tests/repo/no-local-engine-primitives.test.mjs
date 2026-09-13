// Doc/49, tâche 3, correction — ce que le retrait des cinq ponts doit garantir
// n'est pas exprimable en une identité d'objet : sans pont, `src/server/`
// importe la SOURCE du moteur (jamais `dist/`), et une source rechargée deux
// fois donne deux instances de module distinctes (mesuré, cf.
// tests/unit/tokens.test.cjs et tests/unit/observatory-claude-dir.test.ts).
// Ce que C2/C3/C4/C5 nommaient reste vrai : les deux moitiés du produit lisent
// AU MÊME ENDROIT. Ça s'exprime maintenant comme une hygiène de source, pas
// comme une exécution : aucun fichier de `src/server/` ne DÉFINIT localement
// l'une des sept primitives, il les IMPORTE. Une importation ne peut pas
// diverger de ce qu'elle importe ; une jumelle locale, si.
//
// Ce filet ne touche jamais `dist/` — l'ancienne panne (build absent ou
// périmé) appartient à une tâche ultérieure, pas à celle-ci.
//
// L'analyse est SYNTAXIQUE (API du compilateur `typescript`, déjà en
// dépendance de développement), même méthode que `served-web-graph.test.mjs` :
// une expression régulière sur `function emptyUsageBucket` verrait aussi un
// commentaire ou une chaîne qui la mentionne, ce que l'arbre syntaxique évite.
// Seules deux formes comptent comme une DÉFINITION : une déclaration de
// fonction (`function nom() {}`) et une constante initialisée par une
// fonction ou une fléchée (`const nom = () => {}`) — un import, même renommé
// (`import { x as nom }`), n'est ni l'une ni l'autre : ce test le laisse
// passer, il ne cherche que le corps réimplémenté.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const ts = createRequire(path.join(ROOT, 'package.json'))('typescript');

// Les sept primitives que le retrait des ponts a rendues IMPORTABLES
// directement depuis `src/engine/core/` — jsonl (C2), claude-dir (C5), usage
// (C3). `pricing.ts` (computeCost, normalizeModel, pricingKindOf) reste hors
// liste : `src/server/pricing.ts` PORTE une carte de prix en mémoire à lui —
// sa présence n'est pas une jumelle, c'est son rôle propre (doc/49 brief,
// « ce qui reste à pricing.js »).
const PRIMITIVES = new Set([
  'emptyUsageBucket', 'addUsage', 'finiteCount', 'isDedupableMsgId',
  'resolveClaudeDir', 'resolveClaudeJsonPath', 'decodeJsonlLine',
]);

function fichiersServeur() {
  const dir = path.join(ROOT, 'src', 'server');
  const out = [];
  for (const nom of readdirSync(dir, { recursive: true })) {
    const p = path.join(dir, String(nom));
    if (p.endsWith('.ts') && statSync(p).isFile()) out.push(p);
  }
  return out.sort();
}

const estFonction = (n) => !!n && (ts.isArrowFunction(n) || ts.isFunctionExpression(n));

function definitionsLocales(abs) {
  const texte = readFileSync(abs, 'utf8');
  const sf = ts.createSourceFile(abs, texte, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const ligneDe = (n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const trouvees = [];
  const visiter = (n) => {
    if (ts.isFunctionDeclaration(n) && n.name && PRIMITIVES.has(n.name.text)) {
      trouvees.push({ nom: n.name.text, ligne: ligneDe(n) });
    } else if (
      ts.isVariableDeclaration(n) && ts.isIdentifier(n.name)
      && PRIMITIVES.has(n.name.text) && estFonction(n.initializer)
    ) {
      trouvees.push({ nom: n.name.text, ligne: ligneDe(n) });
    }
    ts.forEachChild(n, visiter);
  };
  visiter(sf);
  return trouvees;
}

function toutesLesDefinitions() {
  const out = [];
  for (const abs of fichiersServeur()) {
    const rel = path.relative(ROOT, abs).replaceAll('\\', '/');
    for (const d of definitionsLocales(abs)) out.push(`${rel}:${d.ligne} -> ${d.nom}`);
  }
  return out;
}

test('aucun fichier de src/server ne définit localement une primitive du moteur', () => {
  assert.deepEqual(
    toutesLesDefinitions(),
    [],
    'C2/C3/C4/C5 : ces sept noms n’ont qu’UNE définition, dans src/engine/core/ — ' +
      'un fichier de src/server/ qui en (re)définit une localement recrée la jumelle que ' +
      'le retrait des ponts a supprimée. Importer, ne pas réécrire.',
  );
});

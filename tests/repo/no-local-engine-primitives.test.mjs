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
// Un import, même renommé (`import { x as nom }`), n'est jamais une des
// formes ci-dessous : ce test le laisse passer, il ne cherche que le corps
// réimplémenté.
//
// SEPT FORMES essayées une par une (mutation plantée, exécutée, lue sur le
// disque, puis annulée — voir task-3-report.md § correction round 2/5) :
//   1. `function nom() {}`                         — FunctionDeclaration
//   2. `const nom = () => {}` / `function(){}`       — VariableDeclaration
//   3. `class X { nom() {} }` (et sa jumelle sur un — MethodDeclaration
//      objet littéral, `{ nom() {} }` : MÊME nœud syntaxique)
//   4. `const o = { nom: () => {} }`                 — PropertyAssignment
//   5. `class X { nom = () => {}; }`                 — PropertyDeclaration
//   6. `class X { get/set nom() {} }`                — Get/SetAccessor
//   7. `export { autreChose as nom };`               — ExportSpecifier renommé
//   8. `let nom; nom = () => {};`                    — affectation différée
// Les huit ont été prouvées MANQUÉES avant cet élargissement (exit 0 sur
// chacune), puis ATTRAPÉES après (exit 1 nommant fichier + ligne).
//
// ── Ce que ce filet ne prouve PAS ───────────────────────────────────────────
//   - Une déstructuration depuis un objet tiers (`const { nom } = obj`) :
//     si `obj` est un littéral défini ici, sa propre jumelle est DÉJÀ
//     attrapée (formes 4/5) ; si `obj` vient d'ailleurs (import, paramètre),
//     remonter jusqu'à sa définition demanderait une résolution de symboles,
//     hors de portée d'une analyse syntaxique.
//   - Une affectation sur un objet existant (`obj.nom = () => {}`) : le nom
//     à gauche n'est pas un identifiant nu (forme 8 ne couvre que
//     `nom = …`), et `obj` échappe au même argument que ci-dessus.
//   - Un nom de propriété CALCULÉ (`{ [x]: () => {} }`) : la valeur du nom
//     n'existe qu'à l'exécution, une lecture syntaxique ne peut pas la voir.
//   - Une métaprogrammation (`Object.defineProperty`, `Proxy`) : aucune
//     occurrence dans ce dépôt, et hors de portée d'une lecture d'arbre.
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
const nomDe = (n) => (n && ts.isIdentifier(n) ? n.text : null);

function definitionsLocales(abs) {
  const texte = readFileSync(abs, 'utf8');
  const sf = ts.createSourceFile(abs, texte, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const ligneDe = (n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const trouvees = [];
  const marquer = (n, nom, forme) => trouvees.push({ nom, forme, ligne: ligneDe(n) });
  const visiter = (n) => {
    if (ts.isFunctionDeclaration(n) && n.name && PRIMITIVES.has(n.name.text)) {
      // Forme 1.
      marquer(n, n.name.text, 'déclaration de fonction');
    } else if (
      ts.isVariableDeclaration(n) && ts.isIdentifier(n.name)
      && PRIMITIVES.has(n.name.text) && estFonction(n.initializer)
    ) {
      // Forme 2.
      marquer(n, n.name.text, 'constante fonction/fléchée');
    } else if (
      ts.isMethodDeclaration(n) && ts.isIdentifier(n.name) && PRIMITIVES.has(n.name.text)
    ) {
      // Forme 3 — un seul nœud pour la méthode de classe ET la méthode
      // raccourcie d'objet littéral, mesuré identiques par l'AST.
      marquer(n, n.name.text, 'méthode (classe ou objet littéral)');
    } else if (
      ts.isPropertyAssignment(n) && ts.isIdentifier(n.name)
      && PRIMITIVES.has(n.name.text) && estFonction(n.initializer)
    ) {
      // Forme 4.
      marquer(n, n.name.text, 'propriété d’objet littéral, valeur fonction/fléchée');
    } else if (
      ts.isPropertyDeclaration(n) && ts.isIdentifier(n.name)
      && PRIMITIVES.has(n.name.text) && estFonction(n.initializer)
    ) {
      // Forme 5.
      marquer(n, n.name.text, 'champ de classe, valeur fonction/fléchée');
    } else if (
      (ts.isGetAccessor(n) || ts.isSetAccessor(n)) && ts.isIdentifier(n.name)
      && PRIMITIVES.has(n.name.text)
    ) {
      // Forme 6.
      marquer(n, n.name.text, ts.isGetAccessor(n) ? 'accesseur get' : 'accesseur set');
    } else if (
      ts.isExportSpecifier(n) && PRIMITIVES.has(n.name.text)
      && n.propertyName && n.propertyName.text !== n.name.text
    ) {
      // Forme 7 — un export RENOMMÉ vers le nom d'une primitive ; un
      // passthrough sans renommage (`export { nom }` ou `export { nom } from
      // '...'`) n'a pas de `propertyName` distinct et ne déclenche rien.
      marquer(n, n.name.text, `ré-export renommé (depuis \`${n.propertyName.text}\`)`);
    } else if (
      ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && PRIMITIVES.has(nomDe(n.left)) && estFonction(n.right)
    ) {
      // Forme 8 — déclaration nue ailleurs, affectation différée ici.
      marquer(n, nomDe(n.left), 'affectation différée (nom = fonction/fléchée)');
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
    for (const d of definitionsLocales(abs)) out.push(`${rel}:${d.ligne} -> ${d.nom} (${d.forme})`);
  }
  return out;
}

test('aucun fichier de src/server ne définit localement une primitive du moteur', () => {
  assert.deepEqual(
    toutesLesDefinitions(),
    [],
    'C2/C3/C4/C5 : ces sept noms n’ont qu’UNE définition, dans src/engine/core/ — ' +
      'un fichier de src/server/ qui en (re)définit une localement, sous quelque forme que ' +
      'ce soit, recrée la jumelle que le retrait des ponts a supprimée. Importer, ne pas réécrire.',
  );
});

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
// HUIT FORMES DE DÉFINITION essayées une par une (mutation plantée, exécutée,
// lue sur le disque, puis annulée — voir task-3-report.md § correction round
// 2/5 et 3/5) :
//   1. `function nom() {}`                         — FunctionDeclaration
//   2. `const nom = () => {}` / `function(){}`       — VariableDeclaration
//   3. `class X { nom() {} }` (et sa jumelle sur un — MethodDeclaration
//      objet littéral, `{ nom() {} }` : MÊME nœud syntaxique)
//   4. `const o = { nom: () => {} }`                 — PropertyAssignment
//   5. `class X { nom = () => {}; }`                 — PropertyDeclaration
//   6. `class X { get/set nom() {} }`                — Get/SetAccessor
//   7. `export { autreChose as nom };`               — ExportSpecifier renommé
//   8. `let nom; nom = () => {};`                    — affectation différée
// La re-revue du round 2 en a rejoué six autres SANS rien trouver de manqué
// (`async function`, fonction génératrice, méthode statique, déclaration
// imbriquée dans un bloc) : ces formes-là sont déjà couvertes par les 8
// ci-dessus, qui portent sur le NŒUD (FunctionDeclaration, MethodDeclaration,
// …) et non sur ses modificateurs ni sa position dans l'arbre.
//
// CHACUNE DE CES HUIT FORMES ACCEPTE AUSSI UN NOM PORTÉ AUTREMENT QUE PAR UN
// IDENTIFIANT NU — trouvé en essayant (round 3/5), pas deviné : un nom entre
// guillemets (`{ 'nom': () => {} }`, `{ 'nom'() {} }`) est déjà connu à la
// LECTURE, exactement comme un identifiant — seule la syntaxe qui le porte
// change. Trois porteurs statiques couverts, sur les formes qui les acceptent
// (propriété, méthode, champ, accesseur, export) :
//   - chaîne littérale directe            — `'nom'` / `"nom"`
//   - gabarit SANS substitution           — `` `nom` ``
//   - l'un des deux entre crochets        — `['nom']` / `[\`nom\`]`
// Un gabarit AVEC substitution (`` [`nom${x}`] ``) ou un nom calculé par une
// expression quelconque (`[x]`) restent hors de portée : la valeur n'existe
// qu'à l'exécution, une lecture syntaxique ne peut pas la voir — c'est la
// même limite que documentée plus bas pour la déstructuration et
// l'affectation sur un objet existant.
//
// ── Ce que ce filet ne prouve PAS ───────────────────────────────────────────
//   - Une déstructuration (`const { nom } = obj` ou, renommée,
//     `const { x: nom } = obj`) : elle lie un nom à une clé d'une AUTRE
//     expression, jamais elle-même analysée — aucun corps de fonction
//     n'existe au point de liaison, que la clé source se nomme comme la
//     primitive ou non.
//   - Une affectation sur un objet existant (`obj.nom = () => {}`) : le nom
//     à gauche n'est pas une cible nue (forme 8 ne couvre que `nom = …`), et
//     `obj` échappe au même argument que la déstructuration.
//   - Un nom de propriété CALCULÉ par une expression non littérale
//     (`{ [x]: () => {} }`) ou un gabarit AVEC substitution : la valeur
//     n'existe qu'à l'exécution.
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

// Un nom PORTÉ statiquement dans l'arbre : un identifiant, une chaîne, un
// gabarit sans substitution, ou l'un des trois derrière un nom calculé entre
// crochets (`[ 'nom' ]`, `[ \`nom\` ]`) — mesuré (round 3/5) : les cinq se
// lisent tous par `.text` une fois le nœud `ComputedPropertyName` traversé.
// `null` pour tout le reste (identifiant absent, gabarit AVEC substitution,
// accès de propriété…) : ce sont les cas que ce filet laisse délibérément
// passer, voir l'en-tête.
function nomDe(n) {
  if (!n) return null;
  if (ts.isIdentifier(n) || ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
  if (ts.isComputedPropertyName(n)) return nomDe(n.expression);
  return null;
}

function definitionsLocales(abs) {
  const texte = readFileSync(abs, 'utf8');
  const sf = ts.createSourceFile(abs, texte, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const ligneDe = (n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const trouvees = [];
  const marquer = (n, nom, forme) => trouvees.push({ nom, forme, ligne: ligneDe(n) });
  const visiter = (n) => {
    const nomCible = nomDe(n.name);
    if (ts.isFunctionDeclaration(n) && nomCible && PRIMITIVES.has(nomCible)) {
      // Forme 1.
      marquer(n, nomCible, 'déclaration de fonction');
    } else if (
      ts.isVariableDeclaration(n) && nomCible && PRIMITIVES.has(nomCible) && estFonction(n.initializer)
    ) {
      // Forme 2.
      marquer(n, nomCible, 'constante fonction/fléchée');
    } else if (
      ts.isMethodDeclaration(n) && nomCible && PRIMITIVES.has(nomCible)
    ) {
      // Forme 3 — un seul nœud pour la méthode de classe (statique comprise)
      // ET la méthode raccourcie d'objet littéral, mesuré identiques par
      // l'AST ; `async`/générateur sont des modificateurs du MÊME nœud.
      marquer(n, nomCible, 'méthode (classe ou objet littéral)');
    } else if (
      ts.isPropertyAssignment(n) && nomCible && PRIMITIVES.has(nomCible) && estFonction(n.initializer)
    ) {
      // Forme 4.
      marquer(n, nomCible, 'propriété d’objet littéral, valeur fonction/fléchée');
    } else if (
      ts.isPropertyDeclaration(n) && nomCible && PRIMITIVES.has(nomCible) && estFonction(n.initializer)
    ) {
      // Forme 5.
      marquer(n, nomCible, 'champ de classe, valeur fonction/fléchée');
    } else if (
      (ts.isGetAccessor(n) || ts.isSetAccessor(n)) && nomCible && PRIMITIVES.has(nomCible)
    ) {
      // Forme 6.
      marquer(n, nomCible, ts.isGetAccessor(n) ? 'accesseur get' : 'accesseur set');
    } else if (
      ts.isExportSpecifier(n) && nomCible && PRIMITIVES.has(nomCible)
      && n.propertyName && n.propertyName.text !== nomCible
    ) {
      // Forme 7 — un export RENOMMÉ vers le nom d'une primitive ; un
      // passthrough sans renommage (`export { nom }` ou `export { nom } from
      // '...'`) n'a pas de `propertyName` distinct et ne déclenche rien.
      marquer(n, nomCible, `ré-export renommé (depuis \`${n.propertyName.text}\`)`);
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

// Aucun fichier de `src/server/` ne DÉFINIT localement une primitive du moteur : il
// l'IMPORTE depuis `src/engine/core/`. Une importation ne peut pas diverger de ce
// qu'elle importe ; une jumelle locale, si. Ce filet ne lit jamais `dist/`.
//
// Analyse SYNTAXIQUE (API de `typescript`), comme `served-web-graph.test.ts` : une
// expression régulière verrait aussi un commentaire ou une chaîne. Un import, même
// renommé (`import { x as nom }`), n'est pas une définition et passe.
//
// Huit formes de définition, chacune prouvée par une mutation plantée puis annulée :
//   1. `function nom() {}`                        — FunctionDeclaration
//   2. `const nom = () => {}` / `function(){}`    — VariableDeclaration
//   3. `class X { nom() {} }` et `{ nom() {} }`   — MethodDeclaration (statique, async,
//                                                  générateur : même nœud)
//   4. `const o = { nom: () => {} }`              — PropertyAssignment
//   5. `class X { nom = () => {}; }`              — PropertyDeclaration
//   6. `class X { get/set nom() {} }`             — Get/SetAccessor
//   7. `export { autreChose as nom };`            — ExportSpecifier renommé
//   8. `let nom; nom = () => {};`                 — affectation différée
// Le nom peut être un identifiant, une chaîne, un gabarit sans substitution, ou l'un
// des deux derniers entre `[ ]` : tous sont connus à la lecture.
//
// Ce que ce filet ne prouve pas :
//   - une déstructuration (`const { nom } = obj`) : aucun corps de fonction au point de liaison ;
//   - une affectation sur un objet existant (`obj.nom = () => {}`) ;
//   - un nom calculé par une expression (`{ [x]: … }`) ou un gabarit avec substitution :
//     la valeur n'existe qu'à l'exécution ;
//   - une métaprogrammation (`Object.defineProperty`, `Proxy`) ;
//   - une primitive du moteur écrite autrement qu'en `export function` (`export const f = () => …`) :
//     la liste ne lit que les `export function`, elle en sort sans que rien ne rougisse.
import { expect, test } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const ts: any = createRequire(path.join(ROOT, 'package.json'))('typescript');

// Les primitives sont les fonctions exportées des quatre modules du moteur que le
// serveur importe, formule de coût et normalisation comprises. La carte de prix
// d'affichage de `src/server/pricing.ts` n'en redéfinit aucune : elle reste permise.
const MODULES_DU_MOTEUR = ['usage.ts', 'jsonl.ts', 'claude-dir.ts', 'pricing.ts']
  .map((nom) => path.join(ROOT, 'src', 'engine', 'core', nom));

function fonctionsExportees(abs: string) {
  const sf = ts.createSourceFile(abs, readFileSync(abs, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  return sf.statements
    .filter((s: any) => ts.isFunctionDeclaration(s) && s.name
      && (s.modifiers ?? []).some((m: any) => m.kind === ts.SyntaxKind.ExportKeyword))
    .map((s: any) => s.name.text);
}

const PRIMITIVES_PAR_MODULE = new Map(MODULES_DU_MOTEUR.map((abs) => [abs, fonctionsExportees(abs)]));
const PRIMITIVES = new Set([...PRIMITIVES_PAR_MODULE.values()].flat());

function fichiersServeur() {
  const dir = path.join(ROOT, 'src', 'server');
  const out: string[] = [];
  for (const nom of readdirSync(dir, { recursive: true })) {
    const p = path.join(dir, String(nom));
    if (p.endsWith('.ts') && statSync(p).isFile()) out.push(p);
  }
  return out.sort();
}

const estFonction = (n: any) => !!n && (ts.isArrowFunction(n) || ts.isFunctionExpression(n));

// Un nom PORTÉ statiquement : identifiant, chaîne, gabarit sans substitution, ou l'un
// d'eux derrière un `ComputedPropertyName` (`[ 'nom' ]`) — tous se lisent par `.text`.
// `null` pour le reste, que ce filet laisse passer (voir l'en-tête).
function nomDe(n: any): string | null {
  if (!n) return null;
  if (ts.isIdentifier(n) || ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
  if (ts.isComputedPropertyName(n)) return nomDe(n.expression);
  return null;
}

function definitionsLocales(abs: string) {
  const texte = readFileSync(abs, 'utf8');
  const sf = ts.createSourceFile(abs, texte, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const ligneDe = (n: any) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const trouvees: { nom: string; forme: string; ligne: number }[] = [];
  const marquer = (n: any, nom: string, forme: string) => trouvees.push({ nom, forme, ligne: ligneDe(n) });
  const visiter = (n: any) => {
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
      marquer(n, nomDe(n.left)!, 'affectation différée (nom = fonction/fléchée)');
    }
    ts.forEachChild(n, visiter);
  };
  visiter(sf);
  return trouvees;
}

function toutesLesDefinitions() {
  const out: string[] = [];
  for (const abs of fichiersServeur()) {
    const rel = path.relative(ROOT, abs).replaceAll('\\', '/');
    for (const d of definitionsLocales(abs)) out.push(`${rel}:${d.ligne} -> ${d.nom} (${d.forme})`);
  }
  return out;
}

test('assiette : chacun des quatre modules du moteur exporte au moins une fonction lue', () => {
  // Un module dont aucune fonction exportée n'est lue rendrait le filet vert sans rien chercher.
  const vides = [...PRIMITIVES_PAR_MODULE]
    .filter(([, noms]) => noms.length === 0)
    .map(([abs]) => path.relative(ROOT, abs).replaceAll('\\', '/'));
  expect(vides, `ASSIETTE : aucune fonction exportée lue dans ${vides.join(', ')}`).toEqual([]);
});

test('aucun fichier de src/server ne définit localement une primitive du moteur', () => {
  expect(toutesLesDefinitions(), `ces primitives n’ont qu’UNE définition, dans src/engine/core/ (${[...PRIMITIVES].sort().join(', ')}) — ` +
      'un fichier de src/server/ qui en (re)définit une localement, sous quelque forme que ' +
      'ce soit, recrée une copie locale de la primitive du moteur. Importer, ne pas réécrire.').toEqual([]);
});

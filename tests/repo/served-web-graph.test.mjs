// Le graphe d'imports que le navigateur finit par charger, tenu a sa frontiere.
//
// Le serveur sert `src/web/` DEPUIS LA SOURCE : il retire les types a la
// requete (`readStaticFile`, src/server/routes.ts). Depuis que tout tient dans
// un seul projet TypeScript, plus rien n'empeche un module de `src/web/`
// d'atteindre un module Node PAR TRANSITIVITE — le compilateur ne voit plus
// deux mondes, et une regle ESLint ne franchit jamais un import. Ce test, si :
// il marche le graphe.
//
// Les quatre regles, chacune nommant le fichier ET le specificateur fautif :
//   R1  aucun specificateur non relatif atteignable (donc aucun `node:`, aucun
//       paquet nu) : le navigateur ne sait pas le resoudre ;
//   R2  tout specificateur relatif finit en `.ts` : le serveur sert des `.ts`,
//       un `.js` designerait un fichier qui n'est pas sur le disque ;
//   R3  la cible existe. Une cible introuvable SAUTEE rendrait un faux vert :
//       le graphe s'arreterait avant le module Node qu'il cherche.
//   R4  tout module atteint hors `src/web/` est servi par la table de routes,
//       LUE dans `src/server/routes.ts`. Une seconde liste recopiee ici
//       pourrait diverger de la vraie table sans que rien ne le dise.
// Et R0 : un `import()` dynamique a specificateur calcule arrete la marche —
// elle le DIT au lieu de le deviner.
//
// ─── Type ou valeur : la distinction qui decide de tout ────────────────────
// Mesure sur `node:module.stripTypeScriptTypes`, le retrait que le serveur
// applique lui-meme (mode `strip`) :
//
//   import type { X } from './m.ts';     ->  (ligne entierement blanchie)
//   import { type X } from './m.ts';     ->  import {        } from './m.ts';
//   import { v, type X } from './m.ts';  ->  import { v,      } from './m.ts';
//
// La premiere forme efface la ligne : le navigateur ne demande jamais le
// fichier. Les deux autres LAISSENT l'import : le navigateur VA CHERCHER le
// fichier. Elles sont donc des aretes de VALEUR ici. Deux modules de
// `src/web/` emploient deja la seconde (`viz-errors.ts`, `viz-layout.ts`), et
// ce sont les SEULES aretes par lesquelles `tool-subject.ts` est atteint :
// classer ces formes « type » ferait tomber l'assiette du moteur a un seul
// module — c'est le test d'assiette qui le verrait.
//
// L'analyse est SYNTAXIQUE (API du compilateur `typescript`, deja en
// dependance de developpement), jamais par expression reguliere : un motif
// compte `import(` dans l'expression reguliere francaise
// `/\bqui\s+import(e|ent)\b/i` de `src/engine/doctor/detector.ts` comme un
// import dynamique.
//
// ─── CE QUE CE FILET NE PROUVE PAS ─────────────────────────────────────────
//   1. Que les modules atteints TOURNENT dans un navigateur. Il ne lit que des
//      imports : une API Node atteinte sans import (`process.env`,
//      `globalThis.require`) lui echappe entierement.
//   2. Que la table de routes ne s'ouvre pas trop. Une route
//      `prefix: '/src/engine/'` rendrait R4 verte pour tout le moteur ; c'est
//      `served-ts-strip-check.test.mjs` qui interdit ce prefixe.
//   3. Que le corps servi compile : c'est `served-ts-strip-check.test.mjs`.
//   4. Que le graphe est complet si un `import()` a specificateur calcule
//      apparait : R0 signale l'angle mort, il ne le comble pas.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire, stripTypeScriptTypes } from 'node:module';
import { existsSync, readdirSync, readFileSync, statSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Charger `routes.ts` charge `session-index.ts`, qui cree
// `os.tmpdir()/agent-events` des sa lecture : le bac est pose avant l'import,
// meme parade que `served-ts-strip-check.test.mjs`.
const BAC = mkdtempSync(path.join(os.tmpdir(), 'avtest-web-graph-'));
process.env.TEMP = BAC;
process.env.TMP = BAC;
process.env.TMPDIR = BAC;
process.env.USERPROFILE = BAC;
process.env.HOME = BAC;
after(() => rmSync(BAC, { recursive: true, force: true }));

const { ROUTES } = await import('../../src/server/routes.ts');

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const ts = createRequire(path.join(ROOT, 'package.json'))('typescript');

const rel = (abs) => path.relative(ROOT, abs).replaceAll('\\', '/');

// Le prefixe `/src/web/` sert tout ce qui est sur le disque : on enumere donc
// le disque, comme `staticHandler` le ferait pour n'importe quelle requete.
function racines() {
  const dir = path.join(ROOT, 'src', 'web');
  const out = [];
  for (const nom of readdirSync(dir, { recursive: true })) {
    const p = path.join(dir, String(nom));
    if (p.endsWith('.ts') && statSync(p).isFile()) out.push(p);
  }
  return out.sort();
}

// Les aretes d'un source, classees VALEUR / TYPE par l'arbre syntaxique.
// `kind` permet de relire le MEME code sur du JS deja deshabille de ses types
// (dernier test), ou l'ImportTypeNode n'existe plus.
function aretes(chemin, texte, kind) {
  const sf = ts.createSourceFile(chemin, texte, ts.ScriptTarget.Latest, true, kind);
  const ligne = (n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const out = [];
  const visiter = (n) => {
    if (ts.isImportDeclaration(n)) {
      // `importClause.isTypeOnly` seul : c'est `import type …` qui efface la
      // ligne. Un `ImportSpecifier.isTypeOnly` n'efface QUE le nom, l'import
      // survit et le fichier est demande — forme mixte comprise.
      out.push({
        spec: n.moduleSpecifier.text, ligne: ligne(n), forme: 'import',
        valeur: !(n.importClause && n.importClause.isTypeOnly),
      });
    } else if (ts.isExportDeclaration(n) && n.moduleSpecifier) {
      out.push({
        spec: n.moduleSpecifier.text, ligne: ligne(n), forme: 'export-from',
        valeur: !n.isTypeOnly,
      });
    } else if (ts.isImportTypeNode(n)) {
      // `typeof import('./x.ts')` en position de TYPE : efface par le retrait.
      out.push({ spec: null, ligne: ligne(n), forme: 'import-type-node', valeur: false });
    } else if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const arg = n.arguments[0];
      const litteral = arg && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg));
      out.push({
        spec: litteral ? arg.text : null, ligne: ligne(n), valeur: true,
        forme: litteral ? 'import-dynamique' : 'import-dynamique-calcule',
      });
    }
    ts.forEachChild(n, visiter);
  };
  visiter(sf);
  return out;
}

const aretesSource = (abs) => aretes(abs, readFileSync(abs, 'utf8'), ts.ScriptKind.TS);

function marcher() {
  const vus = new Map();
  const defauts = [];
  const file = racines();
  for (const r of file) vus.set(r, 'racine');
  while (file.length) {
    const p = file.shift();
    for (const a of aretesSource(p)) {
      if (!a.valeur) continue;
      const ou = `${rel(p)}:${a.ligne}`;
      if (a.forme === 'import-dynamique-calcule') {
        defauts.push(`R0 ${ou} : import() dynamique a specificateur calcule — `
          + 'la marche ne peut pas le suivre, le graphe est incomplet.');
        continue;
      }
      const spec = a.spec;
      if (!spec.startsWith('./') && !spec.startsWith('../')) {
        defauts.push(`R1 ${ou} : « ${spec} » n'est pas un specificateur relatif — `
          + 'le navigateur ne sait pas le resoudre (un module Node est arrive dans la page).');
        continue;
      }
      let cible = path.resolve(path.dirname(p), spec);
      if (!spec.endsWith('.ts')) {
        defauts.push(`R2 ${ou} : « ${spec} » ne finit pas en .ts — `
          + 'le serveur sert la source .ts, ce fetch rendrait 404.');
        // On poursuit la marche sur le vrai fichier : une seule cause, un seul
        // rouge, pas une cascade de R3 derriere.
        cible = spec.endsWith('.js') ? `${cible.slice(0, -3)}.ts` : `${cible}.ts`;
      }
      if (!existsSync(cible) || !statSync(cible).isFile()) {
        defauts.push(`R3 ${ou} : « ${spec} » ne designe aucun fichier (${rel(cible)}).`);
        continue;
      }
      if (!vus.has(cible)) { vus.set(cible, ou); file.push(cible); }
    }
  }
  return { vus, defauts };
}

const { vus, defauts } = marcher();
const horsWeb = [...vus.keys()].filter((a) => !rel(a).startsWith('src/web/')).sort();

// R4 lit la vraie table. `prefix` y est accepte parce que la table le connait
// (c'est ainsi que `/src/web/` est servi) ; l'interdiction d'un prefixe sur
// `/src/engine/` appartient a `served-ts-strip-check.test.mjs`.
function servi(chemin) {
  return ROUTES.some((r) => r.method === 'GET'
    && ((typeof r.path === 'string' && r.path === chemin)
      || (typeof r.prefix === 'string' && chemin.startsWith(r.prefix))));
}

test('assiette : au moins 27 racines sous src/web et au moins 2 modules atteints hors src/web', () => {
  // Une assiette tombee a zero rendrait tout le reste vert pour la mauvaise
  // raison. Le plancher du moteur vaut 2 parce que `tool-subject.ts` n'est
  // atteint que par des imports de forme MIXTE : s'ils etaient classes
  // « type », ce compte tomberait a 1.
  const n = racines().length;
  assert.ok(n >= 27, `ASSIETTE : ${n} racine(s) .ts sous src/web, attendu >= 27.`);
  assert.ok(horsWeb.length >= 2,
    `ASSIETTE : ${horsWeb.length} module(s) atteint(s) hors src/web, attendu >= 2 — `
    + 'une arete de forme mixte a-t-elle ete classee « type » ?');
});

test('R0-R3 : le graphe de valeur atteignable depuis src/web ne contient que des .ts relatifs existants', () => {
  assert.deepEqual(defauts, [],
    `${defauts.length} arete(s) que le navigateur ne saurait pas charger :\n  ${defauts.join('\n  ')}`);
});

test('R4 : chaque module atteint hors src/web est servi par la table ROUTES', () => {
  const absents = horsWeb.map((a) => `/${rel(a)}`).filter((u) => !servi(u));
  assert.deepEqual(absents, [],
    'atteints depuis src/web mais ABSENTS de la table de routes (le navigateur recevrait 404) :\n  '
    + `${absents.join('\n  ')}\n  (chemin d'arrivee : ${horsWeb.map((a) => `${rel(a)} <- ${vus.get(a)}`).join(' ; ')})`);
});

test('la classification type/valeur est celle que le retrait de types applique vraiment', () => {
  // Sans ce controle, « type » ou « valeur » reste une opinion sur l'arbre
  // syntaxique. Ici on rejoue le retrait du serveur et on compare les
  // specificateurs SURVIVANTS a ceux que la marche a retenus : si Node change
  // un jour de comportement, ou si la lecture de l'arbre est fausse, l'ecart
  // se voit au lieu de passer en silence.
  const ecarts = [];
  for (const abs of [...vus.keys()].sort()) {
    let nu;
    try {
      nu = stripTypeScriptTypes(readFileSync(abs, 'utf8'), { mode: 'strip' });
    } catch (err) {
      ecarts.push(`${rel(abs)} : retrait des types impossible — ${err.message}`);
      continue;
    }
    const retenus = aretesSource(abs).filter((a) => a.valeur && a.spec !== null).map((a) => a.spec).sort();
    const survivants = aretes(abs, nu, ts.ScriptKind.JS).filter((a) => a.spec !== null).map((a) => a.spec).sort();
    if (JSON.stringify(retenus) !== JSON.stringify(survivants)) {
      ecarts.push(`${rel(abs)} : la marche retient [${retenus.join(', ')}] `
        + `mais le corps servi demande [${survivants.join(', ')}].`);
    }
  }
  assert.deepEqual(ecarts, [], `classification dementie par le corps servi :\n  ${ecarts.join('\n  ')}`);
});

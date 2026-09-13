// Le graphe d'imports que le navigateur charge, tenu a sa frontiere. Le serveur sert
// `src/web/` depuis la source, types retires a la requete (`readStaticFile`) : dans un
// seul projet TypeScript, seul un test qui marche le graphe voit un module Node atteint par transitivite.
//
// Regles, chacune nommant le fichier et le specificateur fautif :
//   R0  un `import()` a specificateur calcule arrete la marche, et elle le dit ;
//   R1  aucun specificateur non relatif (ni `node:`, ni paquet nu) : le navigateur ne le resout pas ;
//   R2  tout specificateur relatif finit en `.ts` : le serveur ne sert que la source `.ts` ;
//   R3  la cible existe : une cible introuvable sautee rendrait un faux vert ;
//   R4  tout module atteint hors `src/web/` est servi par `ROUTES`, lue dans `src/server/routes.ts`.
//
// Type ou valeur, mesure sur `stripTypeScriptTypes` en mode `strip`, celui du serveur :
//   import type { X } from './m.ts';     ->  ligne blanchie, le fichier n'est pas demande
//   import { type X } from './m.ts';     ->  import {        } from './m.ts';   demande
//   import { v, type X } from './m.ts';  ->  import { v,      } from './m.ts';   demande
// Les deux dernieres formes sont des aretes de VALEUR : `tool-subject.ts` n'est atteint que
// par elles (`viz-errors.ts`, `viz-layout.ts`), et le test d'assiette le verrait.
//
// Analyse SYNTAXIQUE (API de `typescript`) : une expression reguliere lirait comme un
// `import(` le motif francais `/\bqui\s+import(e|ent)\b/i` de `src/engine/doctor/detector.ts`.
//
// Ce que ce filet ne prouve pas :
//   - que les modules atteints tournent dans un navigateur : une API Node atteinte sans
//     import (`process.env`, `globalThis.require`) lui echappe ;
//   - que la table de routes ne s'ouvre pas trop (un prefixe qui recouvre `/src/engine/`)
//     ni que le corps servi compile : c'est `served-ts-strip-check.test.mjs` ;
//   - que le graphe est complet quand R0 signale un `import()` calcule ;
//   - que le paquet publie emporte ce que R4 declare servi : c'est
//     `package-entrypoints.test.mjs`, qui croise les routes du moteur avec `files`.
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

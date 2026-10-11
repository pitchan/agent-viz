// La doc Node dit que `stripTypeScriptTypes` n'est pas stable d'une version
// à l'autre : ce test rejoue, sur chaque .ts présent sous src/web et sur les
// 3 primitives du moteur, le même retrait que le serveur.
import { afterAll, expect, test } from 'vitest';
import { readdirSync, statSync, readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// Charger `routes.ts` charge `session-index.ts`, qui crée
// `os.tmpdir()/agent-events` dès sa lecture : le bac est posé avant l'import,
// même parade que `tests/unit/static-ts-route.test.ts`.
const BAC = mkdtempSync(path.join(os.tmpdir(), 'avtest-served-ts-'));
process.env.TEMP = BAC;
process.env.TMP = BAC;
process.env.TMPDIR = BAC;
process.env.USERPROFILE = BAC;
process.env.HOME = BAC;
afterAll(() => rmSync(BAC, { recursive: true, force: true }));

const { ROUTES, readStaticFile } = await import('../../src/server/routes.ts');

const ROOT = path.resolve(import.meta.dirname, '..', '..');

// La liste blanche du moteur se LIT dans ROUTES, jamais recopiée à côté :
// une seconde liste pourrait diverger de la vraie table sans que rien ne le
// dise.
function enginePrimitives() {
  return ROUTES
    .filter(r => r.method === 'GET' && typeof r.path === 'string' && r.path.startsWith('/src/engine/'))
    .map(r => path.join(ROOT, ...r.path!.split('/')));
}

// Le préfixe `/src/web/` sert tout ce qui est sur le disque : on énumère donc
// le disque, comme `staticHandler` le ferait pour n'importe quelle requête.
function webModules() {
  const dir = path.join(ROOT, 'src', 'web');
  const out = [];
  for (const nom of readdirSync(dir, { recursive: true })) {
    const rel = String(nom);
    if (!rel.endsWith('.ts')) continue;
    const p = path.join(dir, rel);
    if (statSync(p).isFile()) out.push(p);
  }
  return out.sort();
}

// Second inventaire de src/web, écrit sans l'option `recursive` : il ne
// partage avec `webModules()` ni l'appel ni la reconstruction des chemins,
// pour qu'une faute de l'un ne soit pas aussi celle de l'autre.
function inventaireWeb(dir: string): string[] {
  const out: string[] = [];
  for (const nom of readdirSync(dir)) {
    const p = path.join(dir, nom);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...inventaireWeb(p));
    else if (s.isFile() && nom.endsWith('.ts')) out.push(p);
  }
  return out;
}

// Deux inventaires vides seraient égaux : les points d'entrée que la page
// déclare, lus dans index.html, prouvent que la boucle n'est pas vide.
function pointsDEntree() {
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  return [...html.matchAll(/<script\b[^>]*type="module"[^>]*src="([^"]+)"/g)]
    .map(m => path.resolve(ROOT, m[1]));
}

const MODULES = webModules();
const PRIMITIVES = enginePrimitives();
const SERVED = [...MODULES, ...PRIMITIVES];

test('la boucle parcourt chaque .ts présent sous src/web, et les 3 primitives du moteur', () => {
  // Arrange
  const relatif = (abs: string) => path.relative(ROOT, abs).replaceAll('\\', '/');
  const web = path.join(ROOT, 'src', 'web') + path.sep;
  const surDisque = inventaireWeb(path.join(ROOT, 'src', 'web'));
  const entrees = pointsDEntree();

  // Act — ce que la boucle plus bas parcourt réellement.
  const parcourus = SERVED.filter(p => p.startsWith(web));
  const horsWeb = SERVED.filter(p => !p.startsWith(web));

  // Assert
  const oublies = surDisque.filter(p => !parcourus.includes(p)).map(relatif);
  const inconnus = parcourus.filter(p => !surDisque.includes(p)).map(relatif);
  const entreesOubliees = entrees.filter(p => !SERVED.includes(p)).map(relatif);
  expect(oublies, `ASSIETTE : ${oublies.length} .ts de src/web sur ${surDisque.length} `
    + `échappe(nt) à la boucle :\n  ${oublies.join('\n  ')}`).toEqual([]);
  expect(inconnus, `ASSIETTE : la boucle parcourt des chemins absents du disque :\n  ${inconnus.join('\n  ')}`).toEqual([]);
  expect(entrees.length, 'ASSIETTE : index.html ne déclare aucun <script type="module">.').toBeGreaterThan(0);
  expect(entreesOubliees, `ASSIETTE : point(s) d'entrée de index.html absent(s) de la boucle :\n  ${entreesOubliees.join('\n  ')}`).toEqual([]);
  expect(PRIMITIVES.length, `ASSIETTE : ${PRIMITIVES.length} primitive(s) du moteur en liste blanche, attendu 3.`).toBe(3);
  expect(horsWeb.map(relatif), 'ASSIETTE : hors de src/web, la boucle parcourt exactement les primitives du moteur.')
    .toEqual(PRIMITIVES.map(relatif));
});

test('aucun prefixe de route ne recouvre /src/engine/ : le filtre ci-dessus ne saute rien', () => {
  // Le filtre d'enginePrimitives() ne lit que route.path : une route ecrite
  // avec route.prefix passerait au travers en silence et ouvrirait tout
  // src/engine/ au navigateur sans que le compte SERVED.length ne bouge.
  //
  // Un prefixe est dangereux dans les DEUX sens, et un seul des deux tests ne
  // suffit pas (mesure) : `/src/engine/core/` tombe SOUS le chemin garde et
  // ouvre events.ts et usage.ts ; `/src/` le RECOUVRE par le haut et ouvre
  // tout le moteur. Le premier ne passe que `r.prefix.startsWith(...)`, le
  // second que `...startsWith(r.prefix)`. Les deux sens, donc. `/src/web/`,
  // la route legitime, n'est attrape par aucun des deux.
  const recouvre = (prefixe: string) => prefixe.startsWith('/src/engine')
    || '/src/engine/'.startsWith(prefixe);
  const fautives = ROUTES
    .filter(r => typeof r.prefix === 'string' && recouvre(r.prefix))
    .map(r => r.prefix);
  expect(fautives, 'la liste blanche du moteur nomme des chemins exacts : aucun prefixe ne doit '
    + `recouvrir /src/engine/ — trouve : ${fautives.join(', ')}`).toEqual([]);
});

for (const abs of SERVED) {
  const rel = path.relative(ROOT, abs).replaceAll('\\', '/');
  test(`${rel} : stripTypeScriptTypes puis node --check`, async () => {
    // Arrange
    const source = readFileSync(abs, 'utf8');

    // Act — le MÊME chemin que la requête HTTP réelle (readStaticFile), pas
    // un appel direct à stripTypeScriptTypes à côté du serveur.
    const { mime, body } = await readStaticFile(abs);

    // Assert
    expect(mime).toBe('application/javascript; charset=utf-8');
    expect(body.toString('utf8').split('\n').length, `${rel} : le corps servi n'a pas le même nombre de lignes que la source — `
      + 'les piles d\'erreur du navigateur mentiraient sur le numéro de ligne.').toBe(source.split('\n').length);

    // .mjs et non .js : sans package.json dans le bac, Node 24 classe un
    // .js par detection et ne verifie RIEN si le corps ressemble a un
    // module ES (import/export) — un .js rendrait toujours exit 0 ici.
    const compile = path.join(BAC, `check-${SERVED.indexOf(abs)}.mjs`);
    writeFileSync(compile, body);
    try {
      execFileSync(process.execPath, ['--check', compile], { stdio: 'pipe' });
    } catch (err: any) {
      expect.fail(`${rel} : node --check refuse le corps servi :\n${String(err.stderr || err.message)}`);
    }
  });
}

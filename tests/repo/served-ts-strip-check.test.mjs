// La doc Node dit que `stripTypeScriptTypes` n'est pas stable d'une version
// à l'autre : ce test rejoue, sur les 29 vrais fichiers servis au navigateur
// (27 modules + 2 primitives du moteur), le même retrait que le serveur.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, statSync, readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// Charger `routes.ts` charge `session-index.ts`, qui crée
// `os.tmpdir()/agent-events` dès sa lecture : le bac est posé avant l'import,
// même parade que `tests/unit/static-ts-route.test.cjs`.
const BAC = mkdtempSync(path.join(os.tmpdir(), 'avtest-served-ts-'));
process.env.TEMP = BAC;
process.env.TMP = BAC;
process.env.TMPDIR = BAC;
process.env.USERPROFILE = BAC;
process.env.HOME = BAC;
after(() => rmSync(BAC, { recursive: true, force: true }));

const { ROUTES, readStaticFile } = await import('../../src/server/routes.ts');

const ROOT = path.resolve(import.meta.dirname, '..', '..');

// La liste blanche du moteur se LIT dans ROUTES, jamais recopiée à côté :
// une seconde liste pourrait diverger de la vraie table sans que rien ne le
// dise.
function enginePrimitives() {
  return ROUTES
    .filter(r => r.method === 'GET' && typeof r.path === 'string' && r.path.startsWith('/src/engine/'))
    .map(r => path.join(ROOT, ...r.path.split('/')));
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

const MODULES = webModules();
const PRIMITIVES = enginePrimitives();
const SERVED = [...MODULES, ...PRIMITIVES];

test('la liste blanche sert exactement 29 fichiers (27 modules + 2 primitives du moteur)', () => {
  assert.equal(MODULES.length, 27, `ASSIETTE : ${MODULES.length} module(s) .ts sous src/web, attendu 27.`);
  assert.equal(PRIMITIVES.length, 2, `ASSIETTE : ${PRIMITIVES.length} primitive(s) du moteur en liste blanche, attendu 2.`);
  assert.equal(SERVED.length, 29);
});

test('aucune route du moteur ne declare de prefixe : le filtre ci-dessus ne saute rien', () => {
  // Le filtre d'enginePrimitives() ne lit que route.path : une route ecrite
  // avec route.prefix passerait au travers en silence et ouvrirait tout
  // src/engine/ au navigateur sans que le compte SERVED.length ne bouge.
  assert.equal(
    ROUTES.filter(r => typeof r.prefix === 'string' && r.prefix.startsWith('/src/engine')).length, 0,
    'la liste blanche du moteur nomme des chemins exacts : aucun prefixe.');
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
    assert.equal(mime, 'application/javascript; charset=utf-8');
    assert.equal(
      body.toString('utf8').split('\n').length,
      source.split('\n').length,
      `${rel} : le corps servi n'a pas le même nombre de lignes que la source — `
      + 'les piles d\'erreur du navigateur mentiraient sur le numéro de ligne.',
    );

    // .mjs et non .js : sans package.json dans le bac, Node 24 classe un
    // .js par detection et ne verifie RIEN si le corps ressemble a un
    // module ES (import/export) — un .js rendrait toujours exit 0 ici.
    const compile = path.join(BAC, `check-${SERVED.indexOf(abs)}.mjs`);
    writeFileSync(compile, body);
    try {
      execFileSync(process.execPath, ['--check', compile], { stdio: 'pipe' });
    } catch (err) {
      assert.fail(`${rel} : node --check refuse le corps servi :\n${String(err.stderr || err.message)}`);
    }
  });
}

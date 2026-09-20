// Chaque fichier de `src/server/` se CHARGE reellement : un import sans extension passe
// `node --check` et n echoue qu au chargement (`ERR_MODULE_NOT_FOUND`), et
// `import.meta.resolve` rend une URL `file://` sans verifier que la cible existe.
//
// `createRequire`, le vrai chargeur de Node sous les deux executeurs, et non `await
// import()` : sous vite-node, `import()` echoue (`Invalid or unexpected token`) sur les
// fichiers a shebang (`hook.ts`, `install-hooks.ts`), que Node retire et vite-node non.
//
// `server.ts` est exclu : le charger lie un port reel, cree `~/.agent-viz/observatory.db`
// et laisse la boucle d evenements active. Le second test ne verifie que la syntaxe de
// son emission, par `node --check` ; ce fichier ne prouve pas qu il s execute.
import { afterAll, expect, test } from 'vitest';
import { readdirSync, statSync, readFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const requireReel = createRequire(import.meta.url);

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const RACINE_SERVEUR = path.join(ROOT, 'src', 'server');

// ── Le bac a sable, pose AVANT le premier chargement de `src/server/**` ───────
// Ce fichier charge tout le graphe de `src/server` : un module qui gagne un effet de
// bord au chargement l execute ici. `os.tmpdir()` et `os.homedir()` relisent
// l environnement a chaque appel, donc les detourner ici suffit.
const BAC = mkdtempSync(path.join(os.tmpdir(), 'avtest-imports-'));
process.env.TEMP = BAC;
process.env.TMP = BAC;
process.env.TMPDIR = BAC;
process.env.USERPROFILE = BAC;
process.env.HOME = BAC;
afterAll(() => rmSync(BAC, { recursive: true, force: true }));

// PROPRIETE 1 — l enumeration porte sur `*.{js,ts}`, pas sur une seule extension : un
// fichier de `src/server/` ecrit dans l une ou l autre est charge, et une enumeration
// qui ne trouve rien fait rougir l assiette du premier test.
const EXTENSIONS = new Set(['.js', '.ts']);

function enumererServeur(dir: string): string[] {
  const out: string[] = [];
  for (const nom of readdirSync(dir)) {
    const p = path.join(dir, nom);
    if (statSync(p).isDirectory()) { out.push(...enumererServeur(p)); continue; }
    if (EXTENSIONS.has(path.extname(nom))) out.push(p);
  }
  return out.sort();
}

// Le point d entree se lit dans le champ `main` de package.json, JAMAIS comme un
// chemin ecrit en dur : interroger le produit plutot qu une expression jumelle fait
// suivre ce test au fichier renomme, au lieu de rougir sur une adresse morte.
function pointDEntree() {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  expect(typeof pkg.main === 'string' && pkg.main.length > 0, `package.json n a pas de champ \`main\` : le point d entree est introuvable (lu : ${JSON.stringify(pkg.main)})`).toBeTruthy();
  return path.join(ROOT, pkg.main);
}

// `main` designe l EMISSION (`dist/server/server.js`) et la boucle charge la SOURCE :
// `tsconfig.build.json` garde la meme arborescence sous `src` et `dist`, donc la source
// du point d entree s obtient en remplacant `dist` par `src` et `.js` par `.ts`.
function sourceDeLEntree(entree: string) {
  const segments = path.relative(ROOT, entree).split(path.sep);
  if (segments[0] !== 'dist') return entree; // deja sous src/ : rien a remapper
  segments[0] = 'src';
  return path.join(ROOT, segments.join(path.sep).replace(/\.js$/, '.ts'));
}

test('chaque fichier de src/server hors server.ts se charge REELLEMENT, zero echec', () => {
  // Arrange
  const tous = enumererServeur(RACINE_SERVEUR);
  const entree = pointDEntree();
  const entreeSource = sourceDeLEntree(entree);

  // L exclusion de `server.ts` est accrochee a la SOURCE du point d entree
  // (voir `sourceDeLEntree`) — pratique, et DANGEREUX si on s arrete la : le
  // jour ou l emission cesserait de preserver l arborescence source/dist, le
  // filtre ci-dessous ne retirerait plus rien et `server.ts` se ferait
  // charger par la boucle. Or le charger LIE UN PORT REEL et CREE
  // `~/.agent-viz/observatory.db` (en-tete de ce fichier). Cette assertion fait
  // ROUGIR ce test le jour ou l ancrage cesse de mordre, au lieu de le laisser
  // charger le point d entree en silence.
  expect(path.resolve(entreeSource).startsWith(path.resolve(RACINE_SERVEUR) + path.sep), `la source du point d entree (${path.relative(ROOT, entreeSource)}) ne tombe plus sous src/server : `
    + 'l exclusion de server.ts dans la boucle ci-dessous ne mord donc plus, et cette boucle '
    + 'chargerait le point d entree — ce qui lie un port reel et cree la base de mesure. '
    + 'Reancrer l exclusion avant de rejouer ce test.').toBeTruthy();

  // `sourceDeLEntree` CALCULE un chemin sans le lire : si l emission cesse d etre
  // nom-preservante, le filtre ne retire rien et la boucle charge `server.ts` pour de
  // vrai, ce qui lie un port reel et cree la base de mesure.
  expect(existsSync(entreeSource), `la source deduite du point d entree (${path.relative(ROOT, entreeSource)}) n existe pas sur le `
    + 'disque : la derivation dist -> src ne resout plus vers un fichier reel, donc le filtre '
    + 'ci-dessous ne retirerait plus rien et server.ts se ferait charger reellement par la boucle '
    + '— ce qui lie un port reel et cree la base de mesure. Reancrer la derivation dist -> src avant '
    + 'de rejouer ce test.').toBeTruthy();

  const cibles = tous.filter((f: string) => path.resolve(f) !== path.resolve(entreeSource));

  // Le bac a sable est VERIFIE, pas suppose : s il ne prenait pas, ce fichier
  // chargerait tous les modules contre le vrai home, en silence.
  const { DIR } = requireReel(path.join(RACINE_SERVEUR, 'session-index.ts'));
  expect(DIR.startsWith(BAC), `dossier d evenements hors du bac a sable : ${DIR}`).toBeTruthy();

  // PROPRIETE 2 — l ASSIETTE est ASSERTEE avant la boucle, et son message nomme le
  // nombre trouve : sans elle, « zero fichier charge, zero echec » est VERT.
  expect(tous.length >= 52, `ASSIETTE : ${tous.length} fichier(s) *.{js,ts} trouves sous src/server, attendu >= 52. `
    + 'Une enumeration qui ne trouve rien rend « zero echec » et se lit comme une reussite.').toBeTruthy();
  expect(cibles.length >= 51, `ASSIETTE : ${cibles.length} cible(s) a charger apres exclusion du point d entree, attendu >= 51.`).toBeTruthy();

  // Act — un chargement REEL, et TOUS les echecs sont rendus, jamais seulement
  // le premier : une reprise d un fichier par lancement serait ingerable, la ou
  // l inventaire complet se lit en une passe.
  const echecs = [];
  for (const f of cibles) {
    try {
      requireReel(f);
    } catch (err: any) {
      echecs.push(`ECHEC ${path.relative(ROOT, f)}  ${err && err.code ? err.code : '(sans code)'}  ${String(err && err.message).split('\n')[0]}`);
    }
  }

  // Assert
  expect(echecs, `${cibles.length - echecs.length}/${cibles.length} charges. Echecs :\n${echecs.join('\n')}`).toEqual([]);
});

test('le point d entree du paquet est du JavaScript syntaxiquement valide', () => {
  // Arrange — le point d entree, lu dans le champ `main`, jamais ecrit en dur.
  const entree = pointDEntree();
  const ext = path.extname(entree);

  // PROPRIETE 3 — ce test ROUGIT le jour ou le point d entree cesse d etre du JavaScript.
  // Sur du TypeScript, `node --check` est INTERMITTENT (mesure) : il refuse `const x = ;;;`
  // mais avale d autres cassures, et passe donc un controle negatif mal choisi.
  expect(ext, `${path.basename(entree)} n est plus du JavaScript : node --check est INTERMITTENT sur du `
    + 'TypeScript (il attrape certaines cassures et en avale d autres). '
    + 'Remplacer ce controle par un tsc --noEmit sur ce seul fichier.').toBe('.js');

  // Act + Assert — `node --check` en sous-processus : charger `server.js` lierait
  // un port et creerait la base de mesure (voir l en-tete de ce fichier).
  try {
    execFileSync(process.execPath, ['--check', entree], { stdio: 'pipe' });
  } catch (err: any) {
    expect.fail(`node --check a refuse ${path.relative(ROOT, entree)} :\n${String(err.stderr || err.message)}`);
  }
});

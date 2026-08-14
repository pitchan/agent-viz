// G3 / IF45.1 — la troisieme barriere de la bascule en ES modules, et la seule
// qui CHARGE REELLEMENT.
//
// Les deux barrieres mecaniques de la migration sont PROUVEES aveugles a la
// classe de panne la plus probable (D14) :
//
//   node --check sur un import SANS extension  ->  exit=0
//   grep des 4 constructions CommonJS          ->  0
//   chargement REEL du meme fichier            ->  ERR_MODULE_NOT_FOUND
//
// `import.meta.resolve` ne comble pas ce trou : mesure — et corrobore par la
// documentation Node v24 (« no longer throws when targeting file: URLs that do
// not map to an existing file ») —, il ne verifie JAMAIS l existence de la
// cible. Un specificateur sans extension, un dossier sans `index.js`, un
// fichier absent rendent chacun une URL `file://`, sans lever. Une barriere qui
// ne peut rougir sur aucune des trois classes qu elle pretend couvrir est de la
// meme famille que le `require.cache` inerte.
//
// D ou un CHARGEMENT REEL de chaque fichier de `src/server/`.
//
// POURQUOI `createRequire(import.meta.url)` ET NON `await import()`. Mesure du
// 2026-08-13, sur ce commit : sous vite-node, `await import(pathToFileURL(f).href)`
// echoue avec `Invalid or unexpected token` sur les DEUX seuls fichiers du
// balayage qui portent un shebang (`hook.js`, `install-hooks.js`) — vite-node
// ne le retire pas, la ou Node le fait. Sous `node --test`, les memes 51
// fichiers se chargent. Un test qui rougirait d un cote et pas de l autre ne
// dirait rien du produit : il dirait quelque chose de l executeur.
//
// `createRequire` interroge le VRAI chargeur de Node — celui que la production
// emploie — sous les deux executeurs. Meme famille que le 7e test
// d `observatory-claude-dir` (D13), et l exception de doc/36 § 1.3 vaut ici au
// meme titre : seul le mecanisme d acces change.
//
// Et il PROUVE UNE CHOSE DE PLUS, dont D12 depend : `require()` d un graphe ES
// portant une attente de haut niveau leve `ERR_REQUIRE_ASYNC_MODULE`. Or les 39
// fichiers `.test.cjs` chargent `src/server` par `require`. Le jour ou un `await`
// de haut niveau entrerait dans ce graphe, ce test rougirait ICI plutot que de
// faire tomber le filet entier ailleurs. La resolution, elle, est verifiee a
// l identique : `require()` d une cible ES resout et lie le graphe complet, donc
// `ERR_MODULE_NOT_FOUND` et `ERR_UNSUPPORTED_DIR_IMPORT` y remontent comme avec
// `import()` — controle negatif joue, voir le rapport de la tache 5.
//
// POURQUOI `server.js` EST EXCLU, et ce n est pas une prudence de principe :
// mesure, son chargement LIE UN PORT REEL, CREE `~/.agent-viz/observatory.db` —
// la base de mesure de la machine — et laisse la boucle d evenements active
// indefiniment (`taskkill` necessaire). Le second test le controle donc par son
// TEXTE seul, jamais par un import.
//
// Aucun test automatique ne prouve que `server.js` s execute reellement de bout
// en bout : c est un etat acquis de ce chantier, ecrit d avance et non une
// hypothese de repli. La premiere preuve d execution reste le premier
// `agent-viz start` de l utilisateur.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, statSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const requireReel = createRequire(import.meta.url);

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const RACINE_SERVEUR = path.join(ROOT, 'src', 'server');

// ── Le bac a sable, pose AVANT le premier chargement de `src/server/**` ───────
// Ce fichier est le SEUL du depot a charger le graphe ENTIER de `src/server`, et
// il etait le seul a le faire sans la redirection que ses deux voisins immediats
// posent (`watchdog-wiring`, `watchdog-routes`) en ecrivant que « le piege est
// actif, pas theorique ». Mesure du 2026-08-13 : le seul effet de portee module
// des 51 fichiers est un `mkdirSync` idempotent — donc borne et benin
// AUJOURD HUI. Mais cette borne est une propriete du code d aujourd hui, pas de
// ce test : le jour ou un module gagne un effet de bord au chargement, ce
// fichier serait celui qui l executerait sur le vrai home. `os.tmpdir()` et
// `os.homedir()` relisent l environnement a chaque appel, donc les detourner ici
// suffit, et `node --test` donne un processus par fichier.
const BAC = mkdtempSync(path.join(os.tmpdir(), 'avtest-imports-'));
process.env.TEMP = BAC;
process.env.TMP = BAC;
process.env.TMPDIR = BAC;
process.env.USERPROFILE = BAC;
process.env.HOME = BAC;
after(() => rmSync(BAC, { recursive: true, force: true }));

// PROPRIETE 1 — l enumeration porte sur `*.{js,ts}`, JAMAIS sur `*.js` seul.
// Toutes les commandes d inventaire de l etape 3 comptent en `-name '*.js'`, ce
// qui est juste AUJOURD HUI (52 fichiers `.js`, 0 `.ts`). Mais le critere n. 2
// de l etape 4 (doc/36) exige que `find src/server src/engine -name '*.js'` soit
// VIDE : la meme enumeration y rendrait ZERO fichier. Ce fichier est le seul du
// depot qui BOUCLE sur une enumeration, donc le seul dont la convention doit
// anticiper cela — sans quoi il passerait vert en ne verifiant rien.
const EXTENSIONS = new Set(['.js', '.ts']);

function enumererServeur(dir) {
  const out = [];
  for (const nom of readdirSync(dir)) {
    const p = path.join(dir, nom);
    if (statSync(p).isDirectory()) { out.push(...enumererServeur(p)); continue; }
    if (EXTENSIONS.has(path.extname(nom))) out.push(p);
  }
  return out.sort();
}

// Le point d entree se lit dans le champ `main` de package.json, et JAMAIS
// comme un chemin ecrit en dur : c est la meme lecon que le controle negatif de
// la garde de danger (interroger le produit, jamais une expression jumelle —
// constat C5), et c est ce qui fait que ce test suit le fichier le jour ou
// l etape 4 le renomme, au lieu de rougir sur une adresse morte.
function pointDEntree() {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.ok(typeof pkg.main === 'string' && pkg.main.length > 0,
    `package.json n a pas de champ \`main\` : le point d entree est introuvable (lu : ${JSON.stringify(pkg.main)})`);
  return path.join(ROOT, pkg.main);
}

// SPECIFICATEUR (etape 4, tache 9) : `main` designe desormais l EMISSION
// (`dist/server/server.js`), plus la SOURCE (`src/server/server.ts`) — la
// comparaison directe entre `entree` et les fichiers de `RACINE_SERVEUR` ne
// peut donc plus mordre, `dist/server` et `src/server` etant deux arbres
// distincts. `tsconfig.node.build.json` fixe `rootDir: src` / `outDir: dist` :
// les deux arbres partagent la MEME arborescence relative (meme geste que
// `PROJECT_ROOT` dans `routes.ts`), donc la source correspondant a `entree`
// se retrouve en substituant `dist` par `src` sur son premier segment et
// `.js` par `.ts` sur son nom — sans quoi ce fichier resterait la SOURCE, pas
// le point d entree, et c est TOUJOURS lui qui doit rester exclu de la
// boucle : lui seul lie le port reel.
function sourceDeLEntree(entree) {
  const segments = path.relative(ROOT, entree).split(path.sep);
  if (segments[0] !== 'dist') return entree; // deja sous src/ : rien a remapper
  segments[0] = 'src';
  return path.join(ROOT, segments.join(path.sep).replace(/\.js$/, '.ts'));
}

test('les 51 fichiers de src/server hors server.js se chargent REELLEMENT, zero echec', () => {
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
  assert.ok(path.resolve(entreeSource).startsWith(path.resolve(RACINE_SERVEUR) + path.sep),
    `la source du point d entree (${path.relative(ROOT, entreeSource)}) ne tombe plus sous src/server : `
    + 'l exclusion de server.ts dans la boucle ci-dessous ne mord donc plus, et cette boucle '
    + 'chargerait le point d entree — ce qui lie un port reel et cree la base de mesure. '
    + 'Reancrer l exclusion avant de rejouer ce test.');

  const cibles = tous.filter(f => path.resolve(f) !== path.resolve(entreeSource));

  // Le bac a sable est VERIFIE, pas suppose : s il ne prenait pas, ce fichier
  // chargerait les 51 modules contre le vrai home, en silence. Meme controle
  // que celui de ses deux voisins, mais porte par une ASSERTION du test n. 1
  // plutot que par un troisieme test — ce plan fixe K = 2.
  const { DIR } = requireReel(path.join(RACINE_SERVEUR, 'session-index.ts'));
  assert.ok(DIR.startsWith(BAC), `dossier d evenements hors du bac a sable : ${DIR}`);

  // PROPRIETE 2 — l ASSIETTE est ASSERTEE avant la boucle, et son message nomme
  // le nombre trouve. Sans elle, « zero fichier charge, zero echec » est VERT :
  // c est la famille de panne exacte que ce chantier a deja payee trois fois
  // (`require.cache` inerte, `import.meta.resolve` inerte, `vi.doMock` inerte).
  assert.ok(tous.length >= 52,
    `ASSIETTE : ${tous.length} fichier(s) *.{js,ts} trouves sous src/server, attendu >= 52. `
    + 'Une enumeration qui ne trouve rien rend « zero echec » et se lit comme une reussite.');
  assert.ok(cibles.length >= 51,
    `ASSIETTE : ${cibles.length} cible(s) a charger apres exclusion du point d entree, attendu >= 51.`);

  // Act — un chargement REEL, et TOUS les echecs sont rendus, jamais seulement
  // le premier : une reprise d un fichier par lancement sur 51 fichiers serait
  // ingerable, la ou l inventaire complet se lit en une passe.
  const echecs = [];
  for (const f of cibles) {
    try {
      requireReel(f);
    } catch (err) {
      echecs.push(`ECHEC ${path.relative(ROOT, f)}  ${err && err.code ? err.code : '(sans code)'}  ${String(err && err.message).split('\n')[0]}`);
    }
  }

  // Assert
  assert.deepEqual(echecs, [],
    `${cibles.length - echecs.length}/${cibles.length} charges. Echecs :\n${echecs.join('\n')}`);
});

test('le point d entree du paquet est du JavaScript syntaxiquement valide', () => {
  // Arrange — le point d entree, lu dans le champ `main`, jamais ecrit en dur.
  const entree = pointDEntree();
  const ext = path.extname(entree);

  // PROPRIETE 3 — ce test ROUGIT BRUYAMMENT le jour ou le point d entree cesse
  // d etre du JavaScript, au lieu de passer en silence. `node --check` n est pas
  // un instrument mort sur du TypeScript : il est INTERMITTENT, et c est PIRE.
  // Mesure (tour 3) : il attrape la forme `const x = ;;;` en `.ts` (exit=1) et
  // AVALE d autres formes de cassure du meme fichier (exit=0). Un instrument
  // franchement mort se demasque au premier controle negatif ; celui-ci PASSE le
  // controle des que celui-ci tombe sur la bonne forme.
  assert.equal(ext, '.js',
    `${path.basename(entree)} n est plus du JavaScript : node --check est INTERMITTENT sur du `
    + 'TypeScript (mesure tour 3 -- il attrape certaines cassures et en avale d autres). '
    + 'Remplacer ce controle par un tsc --noEmit sur ce seul fichier.');

  // Act + Assert — `node --check` en sous-processus : charger `server.js` lierait
  // un port et creerait la base de mesure (voir l en-tete de ce fichier).
  try {
    execFileSync(process.execPath, ['--check', entree], { stdio: 'pipe' });
  } catch (err) {
    assert.fail(`node --check a refuse ${path.relative(ROOT, entree)} :\n${String(err.stderr || err.message)}`);
  }
});

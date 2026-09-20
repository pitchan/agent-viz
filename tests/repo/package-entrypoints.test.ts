// Chaque point d entree de `package.json` (les `bin`, `main`, chaque entree de `files`)
// designe quelque chose sur le disque. Ni le typecheck ni le build ne les regardent, et
// npm IGNORE EN SILENCE une entree `files` absente : pas un plantage, un silence.
//
// PORTEE : une entree qui DESIGNE quelque chose ne dit ni que ce quelque chose est
// COMPLET, ni que le point d entree S EXECUTE — resoudre n est pas tourner.
//
// PRECONDITION : un des deux `bin` et une entree de `files` vivent sous `dist/engine/`,
// genere et git-ignore. Ce filet exige un arbre CONSTRUIT : `npm run build` d abord.
//
// Chaque entree de `files` est un chemin LITTERAL (le depot n emploie aucun glob) : un motif
// y rougirait nommement, un faux positif visible plutot qu un faux negatif silencieux.
import { afterAll, expect, test } from 'vitest';
import { readFileSync, statSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const PKG = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

// Une entree declaree : d ou elle vient, ce qu elle vaut, et si elle doit
// designer un FICHIER. Ce troisieme champ n est pas decoratif : un `bin` ou un
// `main` qui pointerait sur un DOSSIER resout quand meme, et `statSync` seul le
// laisserait passer.
function entreesDeclarees(pkg: any) {
  const acc: { origine: string; valeur: string; fichier: boolean }[] = [];
  for (const [nom, valeur] of Object.entries(pkg.bin ?? {})) {
    acc.push({ origine: `bin.${nom}`, valeur: valeur as string, fichier: true });
  }
  if (typeof pkg.main === 'string') {
    acc.push({ origine: 'main', valeur: pkg.main, fichier: true });
  }
  (pkg.files ?? []).forEach((valeur: string, i: number) => {
    acc.push({ origine: `files[${i}]`, valeur, fichier: false });
  });
  return acc;
}

// `null` quand l entree resout. Sinon, la raison, en clair.
function defaut(entree: { origine: string; valeur: string; fichier: boolean }) {
  let etat;
  try {
    etat = statSync(path.join(ROOT, entree.valeur));
  } catch {
    return 'ne resout pas';
  }
  return entree.fichier && !etat.isFile() ? 'resout, mais pas sur un fichier' : null;
}

test('chaque point d entree declare resout sur le disque', () => {
  // Arrange
  const declarees = entreesDeclarees(PKG);

  // Act
  const mortes = declarees
    .map(entree => ({ entree, raison: defaut(entree) }))
    .filter(({ raison }) => raison !== null)
    .map(({ entree, raison }) => `${entree.origine} → ${entree.valeur} : ${raison}`);

  // Assert
  expect(mortes, 'npm ignore EN SILENCE une entree `files` inexistante, et un `bin` mort ne se voit qu a ' +
      'l installation. Faire suivre l adresse au deplacement — ou, si l entree vit sous `dist/`, ' +
      'lancer `npm run build` avant de conclure.').toEqual([]);
});

// `tsc` ecrase ce qu il emet mais n efface pas ce qu il n emet plus : sans l effacement en
// tete du script build, un fichier perime de `dist/engine/` repart dans le tarball, exit 0.
// Ce test lit le SCRIPT sans lancer `tsc` : `prepublishOnly` repond du build lui-meme.
test('le script build efface dist/engine avant de compiler', () => {
  // Arrange — `search` rend -1 quand le motif manque, ce qui distingue « absent » de
  // « mal place ». Le motif accepte la cible apres l appel, `rmSync('dist/engine', ...)`,
  // comme avant lui, `['dist/engine', ...].forEach(d => ... rmSync(d, ...))`.
  const build = typeof PKG.scripts?.build === 'string' ? PKG.scripts.build : '';
  const effacement = build.search(
    /rmSync\([^)]*['"]dist\/engine['"]|\[[^\]]*['"]dist\/engine['"][^\]]*\][^;]*rmSync\(/,
  );
  const compilation = build.search(/\btsc\b/);
  const manques = [];

  // Act
  if (effacement === -1) manques.push('aucun effacement de `dist/engine`');
  if (compilation === -1) manques.push('aucun appel a `tsc`');
  if (effacement !== -1 && compilation !== -1 && effacement > compilation) {
    manques.push('l effacement SUIT la compilation au lieu de la preceder');
  }

  // Assert
  expect(manques, 'le build doit s auto-nettoyer : sans cet effacement, un marqueur ou un fichier emis par une ' +
      'version anterieure survit dans `dist/engine/` et repart dans le tarball, sans qu aucune ' +
      'commande ne rougisse (exit 0).').toEqual([]);
});

test('package.json declare encore ses trois familles de points d entree', () => {
  // Arrange — c est l ASSIETTE du premier test : un `package.json` prive de `bin`, de
  // `main` ou de `files` lui donnerait moins d entrees a verifier, donc un vert obtenu
  // en ne regardant rien. Ce test est le seul a nommer cette panne-la.
  const manques = [];

  // Act
  if (!PKG.bin || typeof PKG.bin !== 'object' || Object.keys(PKG.bin).length === 0) manques.push('bin');
  if (typeof PKG.main !== 'string' || PKG.main === '') manques.push('main');
  if (!Array.isArray(PKG.files) || PKG.files.length === 0) manques.push('files');

  // Assert
  expect(manques, 'un champ de point d entree disparu ne fait rougir aucun autre filet du depot : retirer ' +
      '`files` livrerait tout l arbre dans le tarball, retirer `bin` ou `main` livrerait un ' +
      'paquet sans commande ni entree de module.').toEqual([]);
});

// Une route /src/engine/... servie mais absente de `files` ne serait pas
// livree dans le paquet publie. `ROUTES` est lu dans `routes.ts`, jamais
// recopie ici : une seconde liste pourrait diverger sans le dire.

// Charger `routes.ts` charge `session-index.ts`, qui cree
// `os.tmpdir()/agent-events` des sa lecture : le bac est pose avant l'import,
// meme parade que `served-web-graph.test.ts`.
const BAC = mkdtempSync(path.join(os.tmpdir(), 'avtest-entrypoints-'));
process.env.TEMP = BAC;
process.env.TMP = BAC;
process.env.TMPDIR = BAC;
process.env.USERPROFILE = BAC;
process.env.HOME = BAC;
afterAll(() => rmSync(BAC, { recursive: true, force: true }));

// Verificateur pur : `routes` sont des chemins relatifs (sans le '/' de tete,
// la forme que `files` porte) ; `files` est l'ensemble declare par
// `package.json`. Rend les routes absentes du manifeste, EN LES NOMMANT.
export function routesAbsentesDuManifeste(routes: string[], files: Set<string>) {
  return routes.filter((r) => !files.has(r));
}

test('le verificateur signale une route absente du manifeste, en la nommant', () => {
  const absentes = routesAbsentesDuManifeste(
    ['src/engine/core/usage.ts', 'src/engine/core/clock-time.ts'],
    new Set(['src/engine/core/usage.ts']),
  );
  expect(absentes).toEqual(['src/engine/core/clock-time.ts']);
});

test('le verificateur accepte quand toutes les routes figurent dans le manifeste', () => {
  const absentes = routesAbsentesDuManifeste(
    ['src/engine/core/usage.ts'],
    new Set(['src/engine/core/usage.ts', 'dist/engine/']),
  );
  expect(absentes).toEqual([]);
});

const { ROUTES } = await import('../../src/server/routes.ts');
const routesEngine = ROUTES
  .filter((r) => typeof r.path === 'string' && r.path.startsWith('/src/engine/'))
  .map((r) => r.path!.slice(1)); // retire le '/' de tete : `files` porte des chemins relatifs

test('assiette : au moins une route /src/engine/... a verifier', () => {
  // Un balayage qui ne voit rien passerait aussi, et ne prouverait rien.
  expect(routesEngine.length >= 1, `assiette suspecte : ${routesEngine.length} route(s) vue(s).`).toBeTruthy();
});

test('chaque route /src/engine/... du serveur figure dans `files`', () => {
  const absentes = routesAbsentesDuManifeste(routesEngine, new Set(PKG.files ?? []));
  expect(absentes, 'route(s) servie(s) par le serveur mais absente(s) de `files` : le paquet publie ne les ' +
      `livrerait pas, alors que le serveur de developpement les sert : ${absentes.join(', ')}`).toEqual([]);
});

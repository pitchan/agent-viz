// doc/36 § 3.0 ter — la SEULE surface du produit qu aucun instrument ne regarde.
//
// Relevee a la fin de l etape 2 de la migration, par la premiere revue qui ait
// installe le paquet et lance le produit : sept taches, sept revues
// independantes, dix commits et une etiquette de version — et personne n avait
// execute `node bin/agent-viz.js --version`. Les trois `bin`, le `main` et
// chaque entree de `files` de `package.json` ne sont vus ni par le typecheck, ni
// par le build, ni par les tests, ni par le filet de citations. Verifie par
// commande au moment d ecrire ce fichier : les deux seuls tests qui lisent le
// `package.json` de la racine y lisent `scripts.build` et `version`, jamais un
// point d entree.
//
// Et npm IGNORE EN SILENCE une entree `files` inexistante. C est ce qui a rendu
// invisible, pendant deux taches de l etape 2, le fait qu un `npm pack` n aurait
// pas livre le moteur : des entrees de `files` designaient un dossier que le
// meme commit venait de supprimer, sans qu aucune commande ne rougisse. Pas un
// plantage, un silence.
//
// PORTEE — ecrite parce qu une commande dont on ignore la portee finit par
// servir de preuve de ce qu elle ne regarde pas :
//   - ce filet dit qu une entree DESIGNE quelque chose sur le disque. Il ne dit
//     pas que ce quelque chose soit COMPLET : la completude du build est
//     l affaire de `REQUIRED_DIST` / `missingDistFiles` (tests/install/paths.test.ts) ;
//   - il ne dit pas non plus que le point d entree S EXECUTE. Resoudre n est pas
//     tourner, et l etape 3 est precisement celle qui peut casser l execution en
//     laissant la resolution intacte — une racine passee en `"type": "module"`
//     ne deplace aucun fichier. D ou les trois commandes de fin d etape, qui
//     restent : `node bin/agent-viz.js --version`,
//     `node dist/engine/cli.js --version`, `npm pack --dry-run --ignore-scripts`.
//
// PRECONDITION : deux des trois `bin` et une entree de `files` vivent sous
// `dist/engine/`, genere et git-ignore. Ce filet exige donc un arbre CONSTRUIT,
// au meme titre qu une douzaine d autres — `npm run build` d abord.
//
// MOTIFS DE GLOB : le champ `files` accepte des motifs ; ce depot n en emploie
// aucun. Ce filet traite chaque entree comme un chemin LITTERAL, donc un motif y
// rougirait, nommement. C est voulu — un faux positif se raye a la main, la ou un
// faux negatif se lit comme une preuve. Etendre ce filet aux motifs devient alors
// une decision explicite, jamais un effet de bord.
//
// Ce filet n est PAS un test unitaire (il lit le vrai disque) : c est une
// verification d hygiene du depot, d ou `tests/repo/` — meme famille que
// `stale-path-citations.test.mjs`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const PKG = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

// Une entree declaree : d ou elle vient, ce qu elle vaut, et si elle doit
// designer un FICHIER. Ce troisieme champ n est pas decoratif : un `bin` ou un
// `main` qui pointerait sur un DOSSIER resout quand meme, et `statSync` seul le
// laisserait passer.
function entreesDeclarees(pkg) {
  const acc = [];
  for (const [nom, valeur] of Object.entries(pkg.bin ?? {})) {
    acc.push({ origine: `bin.${nom}`, valeur, fichier: true });
  }
  if (typeof pkg.main === 'string') {
    acc.push({ origine: 'main', valeur: pkg.main, fichier: true });
  }
  (pkg.files ?? []).forEach((valeur, i) => {
    acc.push({ origine: `files[${i}]`, valeur, fichier: false });
  });
  return acc;
}

// `null` quand l entree resout. Sinon, la raison, en clair.
function defaut(entree) {
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
  assert.deepEqual(
    mortes,
    [],
    'npm ignore EN SILENCE une entree `files` inexistante, et un `bin` mort ne se voit qu a ' +
      'l installation. Faire suivre l adresse au deplacement — ou, si l entree vit sous `dist/`, ' +
      'lancer `npm run build` avant de conclure.',
  );
});

// L auto-nettoyage du build. L etape 3 a supprime le marqueur ESM de
// `dist/engine/` et son poseur : la racine etant passee en `"type": "module"`,
// le marqueur n a plus d objet. Mais un `dist/engine/package.json` DEJA pose sur
// le disque survit a une recompilation — `tsc` ecrase ce qu il emet, il n efface
// pas ce qu il n emet plus. D ou l effacement en tete du script.
//
// Son absence a ete mesuree SILENCIEUSE : `npm run build` sort en 0 et `npm
// pack` repart a 172 fichiers au lieu de 171, le tarball reembarquant un
// marqueur perime. Aucune commande ne rougit. Or plus aucun test ne lisait
// `scripts.build` depuis que la forme bon marche qui le faisait a ete effacee
// dans le meme commit (206d1ad) : ce test est cette forme, rendue.
//
// PORTEE — meme discipline que le filet ci-dessus : il lit le SCRIPT, il ne
// lance pas le build. Il dit que l effacement est declare et qu il PRECEDE la
// compilation ; il ne dit pas que le build reussisse, ce dont `prepublishOnly`
// repond deja. Lancer `tsc` ici couterait des secondes a chaque run pour
// redire ce qui est verifie ailleurs.
test('le script build efface dist/engine avant de compiler', () => {
  // Arrange — les deux positions dans le script, en clair. `search` rend -1
  // quand le motif manque, ce qui distingue « absent » de « mal place ».
  //
  // SPECIFICATEUR (etape 4, tache 9) : le script d avant appelait
  // `rmSync('dist/engine', ...)` directement — la cible suivait l appel dans
  // le texte. Celui d apres partage l effacement de `dist/engine` ET
  // `dist/server` dans un seul `rmSync`, via `['dist/engine','dist/server']
  // .forEach(d=>...rmSync(d,...))` : la cible PRECEDE desormais l appel. Le
  // motif reconnait les deux ordres — l exigence qu il verifie ne bouge pas :
  // `rmSync` doit toujours porter sur `dist/engine`, quelque part avant `tsc`.
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
  assert.deepEqual(
    manques,
    [],
    'le build doit s auto-nettoyer : sans cet effacement, un marqueur ou un fichier emis par une ' +
      'version anterieure survit dans `dist/engine/` et repart dans le tarball, sans qu aucune ' +
      'commande ne rougisse (exit 0, `npm pack` a 172 au lieu de 171).',
  );
});

test('package.json declare encore ses trois familles de points d entree', () => {
  // Arrange — c est l ASSIETTE du test ci-dessus, et elle vit ici plutot qu en
  // double a l interieur de lui : un `package.json` prive de `bin`, de `main` ou
  // de `files` lui donnerait moins d entrees a verifier, donc un vert obtenu en
  // ne regardant rien. Ce second test est le seul a nommer cette panne-la.
  const manques = [];

  // Act
  if (!PKG.bin || typeof PKG.bin !== 'object' || Object.keys(PKG.bin).length === 0) manques.push('bin');
  if (typeof PKG.main !== 'string' || PKG.main === '') manques.push('main');
  if (!Array.isArray(PKG.files) || PKG.files.length === 0) manques.push('files');

  // Assert
  assert.deepEqual(
    manques,
    [],
    'un champ de point d entree disparu ne fait rougir aucun autre filet du depot : retirer ' +
      '`files` livrerait tout l arbre dans le tarball, retirer `bin` ou `main` livrerait un ' +
      'paquet sans commande ni entree de module.',
  );
});

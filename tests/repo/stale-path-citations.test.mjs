// `lib/`, `public/` et `netgain/` sont des racines MORTES, absentes du depot : une
// citation qui les nomme ne resout pas, et un detecteur fonde sur `fs.existsSync` ne
// la voit donc jamais. D ou une LISTE NOIRE : leur simple APPARITION est la preuve.
//
// Aucune extension n est exigee : une citation qui nomme un DOSSIER (`lib/`) est vue.
//
// Ce filet n est PAS un test unitaire (il lit le vrai disque, cf.
// `tests/CLAUDE.md` § 4) : c est une verification d hygiene du depot, d ou
// `tests/repo/` — meme famille que `documentation-citations.test.mjs`.
//
// Le motif prefere le FAUX POSITIF, visible et inscrit en liste blanche nommee, au
// FAUX NEGATIF silencieux. D ou le second test : une entree de liste blanche qui ne
// trouve plus rien est ROUGE, sans quoi elle couvrirait un jour une citation neuve.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');

const ARBRES = ['src', 'bin', 'tests', 'scripts', 'docs'];
// Les Markdown de la racine ne sont sous aucun des ARBRES : sans cette liste, ils ne
// sont jamais lus, qu ils figurent ou non dans EXCLUS.
const MARKDOWN_RACINE = ['ARCHITECTURE.md', 'README.md', 'CLAUDE.md'];

const DOSSIERS_IGNORES = new Set(['node_modules', '.git', 'dist']);
const EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.ts', '.mts', '.tsx', '.html', '.css', '.md']);

// Exclus EN BLOC, chacun pour une raison nommee.
const EXCLUS = [
  // Rapport d audit DATE et materiel qui le rejoue : ses scripts adressent l arbre
  // qu ils ont mesure. Les reecrire mentirait sur la mesure.
  'docs/audit-qualite-code.md',
  'docs/audit/',
  // Plans et specs DATES, du meme genre — et git-ignores.
  'docs/superpowers/',
  // Ce fichier-ci : la liste blanche cite NECESSAIREMENT ce qu elle protege, et
  // l en-tete nomme les trois racines mortes pour dire pourquoi elles le sont.
  // Se balayer soi-meme rendrait une liste blanche qui se couvre ELLE-MEME —
  // une exemption invisible dans le bruit. AUCUN volume n est ecrit ici : il
  // grandit a chaque entree ajoutee, donc tout chiffre y serait faux au commit
  // suivant. Pour le connaitre, la commande :
  //   grep -cE '(^|[^A-Za-z0-9_-])(lib|public|netgain)/' <ce fichier>
  'tests/repo/stale-path-citations.test.mjs',
];

// Les trois racines mortes. `(^|[^A-Za-z0-9_-])` evite `sqlib/`, `republic/`…
const RACINE_MORTE = /(^|[^A-Za-z0-9_-])(lib|public|netgain)\//;

// ── La liste blanche des survivants deliberes ────────────────────────────────
//
// Une entree = { fichier, fragment, raison }. Une occurrence est couverte si
// son fichier porte une entree dont le `fragment` est contenu dans la ligne.
// Le fragment, et non le numero de ligne : un numero se perime au premier ajout
// au-dessus, et un test d hygiene qui rougit sur un ajout innocent finit
// desactive.
const LISTE_BLANCHE = [
  // FORMES HISTORIQUES RECONNUES, que le produit doit continuer de reconnaitre.
  { fichier: 'src/server/install-hooks/settings-io.ts', fragment: 'node /abs/.../agent-viz/lib/hook.js', raison: 'une des 4 formes historiques que `isAgentVizHook` doit reconnaitre' },

  // DONNEES DE TEST — un chemin SIMULE, dont on asserte autre chose que le chemin.
  { fichier: 'tests/unit/install-hooks.test.cjs', fragment: "'node /tmp/agent-viz/lib/hook.js --source=claude'", raison: 'jumeau cote test de la forme historique n 2 : perime EXPRES' },
  { fichier: 'tests/unit/tool-subject.test.mjs', fragment: "file_path: '/home/v/agent-viz/lib/hook.js'", raison: 'chemin simule hors de ce depot : le test asserte le SUJET, pas l adresse' },
  { fichier: 'tests/unit/watchdog-alert-content.test.mjs', fragment: '"session_id" lib/server/observatory --stats', raison: 'commande rg SIMULEE dans un evenement : le test asserte le libelle de l alerte' },
  { fichier: 'tests/unit/watchdog-alert-content.test.mjs', fragment: "file_path: '/repo/lib/hook.js'", raison: 'chemin simule hors de ce depot' },

  // RECITS D AVANT — la phrase nomme l adresse d avant pour dire qu elle est d avant ;
  // la reecrire la rendrait fausse.
  { fichier: 'docs/sources-externes.md', fragment: 'netgain/docs/calibration-observatoire-m1.md', raison: 'l adresse morte que ce fichier existe pour remplacer' },
  { fichier: 'docs/sources-externes.md', fragment: '`netgain/docs/` tant que le moteur y', raison: 'la phrase nomme l adresse d avant de ces documents, comme adresse d avant : la reecrire la rendrait fausse' },

  // FAUX POSITIF CONNU — un `lib/` VIVANT, sous `docs/audit/scripts/`, pas une racine morte.
  { fichier: 'docs/sources-externes.md', fragment: 'docs/audit/scripts/lib/', raison: '`docs/audit/scripts/lib/` existe : un `lib/` vivant sous le materiel de l audit, pas une racine morte' },
];

function fichiersBalayes() {
  const acc = [];
  const marche = dir => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      const rel = path.relative(ROOT, abs).replaceAll('\\', '/');
      if (EXCLUS.some(x => rel === x || rel.startsWith(x))) continue;
      if (e.isDirectory()) {
        if (!DOSSIERS_IGNORES.has(e.name)) marche(abs);
      } else if (EXTENSIONS.has(path.extname(e.name))) {
        acc.push(rel);
      }
    }
  };
  for (const arbre of ARBRES) {
    const abs = path.join(ROOT, arbre);
    if (existsSync(abs)) marche(abs);
  }
  for (const md of MARKDOWN_RACINE) {
    if (existsSync(path.join(ROOT, md)) && !EXCLUS.includes(md)) acc.push(md);
  }
  return acc;
}

function occurrences() {
  const trouvees = [];
  for (const rel of fichiersBalayes()) {
    readFileSync(path.join(ROOT, rel), 'utf8').split(/\r?\n/).forEach((ligne, i) => {
      if (RACINE_MORTE.test(ligne)) trouvees.push({ fichier: rel, ligne: i + 1, texte: ligne });
    });
  }
  return trouvees;
}

// Les deux helpers de liste blanche, partages par les trois filets de ce fichier :
// une occurrence est couverte par une entree de meme fichier dont le fragment est
// dans la ligne ; une entree qui ne couvre plus rien est orpheline.
const couvertePar = (occ, liste = LISTE_BLANCHE) =>
  liste.find(e => e.fichier === occ.fichier && occ.texte.includes(e.fragment));

const orphelinesDe = (liste, occurrencesVues) =>
  liste.filter(e => !occurrencesVues.some(o => couvertePar(o, [e])));

test('aucune citation de lib/, public/ ou netgain/ hors liste blanche', () => {
  // Arrange
  const toutes = occurrences();

  // Act
  const perimees = toutes.filter(o => !couvertePar(o));

  // Assert — pas de plancher : un balayage qui ne lit rien rend orphelines les
  // entrees de LISTE_BLANCHE, et le test suivant rougit en les nommant.
  assert.deepEqual(
    perimees.map(o => `${o.fichier}:${o.ligne} \u2192 ${o.texte.trim()}`),
    [],
    '`lib/`, `public/` et `netgain/` n existent plus : une citation qui les nomme envoie le lecteur nulle part. ' +
      'La corriger, ou l inscrire dans LISTE_BLANCHE avec sa raison.',
  );
});

test('chaque entree de la liste blanche protege encore quelque chose', () => {
  // Arrange
  const toutes = occurrences();

  // Act
  const orphelines = orphelinesDe(LISTE_BLANCHE, toutes);

  // Assert
  assert.deepEqual(
    orphelines.map(e => `${e.fichier} \u2192 ${e.fragment}`),
    [],
    'une entree de liste blanche sans occurrence est une exemption qui a survecu a ce qu elle protegeait : ' +
      'la retirer, sinon elle couvrira un jour une citation neuve.',
  );
});

// ── Les citations d un ancien nom `*.test.js` ───────────────────────────────
//
// `RACINE_MORTE` guette un DOSSIER mort, pas un NOM DE FICHIER qui a change
// d extension : les tests CommonJS s appelaient `*.test.js` avant leur renommage
// en `.test.cjs`, et une citation de l ancien nom pointe vers un fichier absent.
//
// Deux listes posees PAR-DESSUS `fichiersBalayes()`, reutilise tel quel : lui seul
// porte les exclusions communes. Ni l une ni l autre ne touche `EXCLUS` ni
// `LISTE_BLANCHE` : y ajouter changerait ce que les deux tests ci-dessus prouvent.
const EXCLUS_TEST_JS = [
  // Litteraux fabriques ('a.test.js', 'b.test.js'...) : donnees de test pour
  // `formatId` et le reporter node:test, pas des citations d un fichier reel.
  // Rien a proteger fragment par fragment : le fichier entier est hors sujet.
  'tests/unit/test-ids-format.test.mjs',
];

// Ancre sur un identifiant (lettres/chiffres/tiret/underscore) immediatement
// avant `.test.js` : matche `pricing.test.js`, pas l extension nue d un decompte
// comme « 42 `.test.js` », qui ne cite aucun fichier.
const CITATION_TEST_JS = /[A-Za-z0-9_-]+\.test\.js\b/;

// Une entree = { fichier, fragment, raison } : une citation d un ancien nom
// `*.test.js` que reecrire rendrait fausse. Aucune n est citee aujourd hui.
const LISTE_BLANCHE_TEST_JS = [];

function occurrencesTestJs() {
  const trouvees = [];
  for (const rel of fichiersBalayes()) {
    if (EXCLUS_TEST_JS.some(x => rel === x || rel.startsWith(x))) continue;
    readFileSync(path.join(ROOT, rel), 'utf8').split(/\r?\n/).forEach((ligne, i) => {
      if (CITATION_TEST_JS.test(ligne)) trouvees.push({ fichier: rel, ligne: i + 1, texte: ligne });
    });
  }
  return trouvees;
}

test('aucune citation d un ancien nom .test.js hors liste blanche, et chaque exemption protege encore quelque chose', () => {
  // Arrange
  const toutes = occurrencesTestJs();

  // Act \u2014 premiere garantie : aucune citation hors liste blanche.
  const perimees = toutes.filter(o => !couvertePar(o, LISTE_BLANCHE_TEST_JS));

  // Assert
  assert.deepEqual(
    perimees.map(o => `${o.fichier}:${o.ligne} \u2192 ${o.texte.trim()}`),
    [],
    'citation d un ancien nom .test.js hors liste blanche : la reecrire avec le nom actuel, ' +
      'ou l inscrire dans LISTE_BLANCHE_TEST_JS avec sa raison.',
  );

  // Act \u2014 seconde garantie : aucune exemption (EXCLUS_TEST_JS ou
  // LISTE_BLANCHE_TEST_JS) n a survecu a ce qu elle protegeait.
  const exclusOrphelins = EXCLUS_TEST_JS.filter(rel => {
    const abs = path.join(ROOT, rel);
    if (!existsSync(abs)) return true;
    return !readFileSync(abs, 'utf8').split(/\r?\n/).some(l => CITATION_TEST_JS.test(l));
  });
  const blancheOrphelines = orphelinesDe(LISTE_BLANCHE_TEST_JS, toutes);

  // Assert
  assert.deepEqual(
    exclusOrphelins,
    [],
    'une entree de EXCLUS_TEST_JS dont le fichier ne cite plus aucun .test.js : exemption devenue inutile, a retirer.',
  );
  assert.deepEqual(
    blancheOrphelines.map(e => `${e.fichier} \u2192 ${e.fragment}`),
    [],
    'une entree de LISTE_BLANCHE_TEST_JS sans occurrence a survecu a ce qu elle protegeait : la retirer.',
  );
});

// ── Les citations d un fichier `src/` absent du disque ──────────────────────
//
// `src/` est une racine VIVANTE : son apparition ne prouve rien, c est
// l existence du fichier cite qui tranche. Memes helpers de liste blanche.
const DOCUMENTS_CITANT_SRC = ['ARCHITECTURE.md', 'README.md', 'CLAUDE.md', 'docs/netgain.md'];

// Garde de tete : pas de `foo-src/`. Garde de queue : `x.json` ne se lit pas `x.js`.
const CITATION_SRC = /(?<![A-Za-z0-9_-])src\/(?:server|engine|web)\/[A-Za-z0-9_./-]*\.(?:ts|js|mjs|cjs)(?![A-Za-z0-9_])/g;

// Une entree = { fichier, fragment, raison } : une sortie historique que la
// reecrire rendrait fausse. Aucune n est citee aujourd hui.
const LISTE_BLANCHE_SRC = [];

function citationsSrc() {
  const trouvees = [];
  for (const rel of DOCUMENTS_CITANT_SRC) {
    readFileSync(path.join(ROOT, rel), 'utf8').split(/\r?\n/).forEach((ligne, i) => {
      for (const m of ligne.matchAll(CITATION_SRC)) {
        trouvees.push({ fichier: rel, ligne: i + 1, texte: ligne, chemin: m[0] });
      }
    });
  }
  return trouvees;
}

const estFichier = rel => existsSync(path.join(ROOT, rel)) && statSync(path.join(ROOT, rel)).isFile();

test('aucune citation d un fichier src/ absent du disque hors liste blanche', () => {
  // Arrange
  const toutes = citationsSrc();

  // Act
  const absentes = toutes.filter(o => !estFichier(o.chemin) && !couvertePar(o, LISTE_BLANCHE_SRC));

  // Assert — plancher : un motif qui ne mord plus rendrait un vert sans rien lire.
  assert.ok(toutes.length >= 10, `assiette suspecte : ${toutes.length} citations src/ vues, attendu >= 10`);
  assert.deepEqual(
    absentes.map(o => `${o.fichier}:${o.ligne} → ${o.chemin}`),
    [],
    'une citation d un fichier src/ qui n existe pas envoie le lecteur nulle part : ' +
      'la faire suivre le code, ou l inscrire dans LISTE_BLANCHE_SRC avec sa raison.',
  );
});

test('chaque entree de LISTE_BLANCHE_SRC protege encore une citation absente', () => {
  // Arrange
  const absentes = citationsSrc().filter(o => !estFichier(o.chemin));

  // Act
  const orphelines = orphelinesDe(LISTE_BLANCHE_SRC, absentes);

  // Assert
  assert.deepEqual(
    orphelines.map(e => `${e.fichier} → ${e.fragment}`),
    [],
    'une entree de LISTE_BLANCHE_SRC qui ne couvre plus aucune citation absente : la retirer.',
  );
});

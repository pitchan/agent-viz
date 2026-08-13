// D8 — le critere d arret des citations est une LISTE NOIRE, pas un detecteur
// qui resout.
//
// Le detecteur d inventaire de l etape 2 reposait sur `fs.existsSync` : « une
// adresse est un chemin qui resout ». C est un instrument d AVANT le
// deplacement. Apres les `git mv`, `lib/`, `public/` et `netgain/` n existent
// plus : les citations perimees cessent de resoudre et deviennent INVISIBLES
// (mesure : 46 -> 19 et 57 -> 23). Le commit qui corrige ces citations n avait
// donc aucun critere falsifiable — une citation oubliee ne rougissait rien.
//
// La logique s inverse. Les trois racines sont mortes, donc leur simple
// APPARITION est la preuve. Pas d `existsSync`, pas d extension exigee : cela
// attrape du meme coup les citations qui nomment un DOSSIER (`lib/`), qu aucun
// motif a extension ne pouvait voir.
//
// Ce filet n est PAS un test unitaire (il lit le vrai disque, cf.
// `tests/CLAUDE.md` § 4) : c est une verification d hygiene du depot, d ou
// `tests/repo/` — meme famille que `documentation-citations.test.mjs`.
//
// Le motif prefere le FAUX POSITIF — visible, il part en liste blanche nommee —
// au FAUX NEGATIF, silencieux, que ce chantier a deja paye quatre fois. D ou le
// second test : une entree de liste blanche qui ne trouve plus rien est ROUGE
// elle aussi, sans quoi la liste survivrait a ce qu elle protege et couvrirait
// un jour une citation neuve.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');

const ARBRES = ['src', 'bin', 'tests', 'scripts', 'docs'];
// `CLAUDE.md` ajoute au solde de la dette (2026-08-13) : l exclure d EXCLUS ne
// suffisait pas, il n a JAMAIS ete dans l assiette — preuve par controle
// negatif, le filet reste vert avec ses trois citations mortes encore en place.
const MARKDOWN_RACINE = ['ARCHITECTURE.md', 'README.md', 'CLAUDE.md'];

const DOSSIERS_IGNORES = new Set(['node_modules', '.git', 'dist']);
const EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.ts', '.mts', '.tsx', '.html', '.css', '.md']);

// Exclus EN BLOC, chacun pour une raison nommee.
const EXCLUS = [
  // Rapport DATE sur `4a4dc46` et materiel qui le rejoue : ses scripts adressent
  // l arbre qu ils ont mesure. Les reecrire mentirait sur la mesure.
  'docs/audit-qualite-code.md',
  'docs/audit/',
  // Plans et specs DATES, du meme genre — et git-ignores.
  'docs/superpowers/',
  // DETTE SOLDEE (2026-08-13) : `CLAUDE.md` et `tests/CLAUDE.md` figuraient ici
  // tant que le plan de l etape 2 interdisait d y toucher — trois citations de
  // l arbre mort dans le premier, une citation `.test.js` d avant le step 1
  // dans le second. Les deux sont corriges et BALAYES depuis : les retirer
  // d ici etait la condition de solde inscrite dans ce commentaire meme.
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
  // CONSTANTES, par conception — la queue d AVANT la fusion EST la donnee.
  { fichier: 'src/engine/install/rupture.ts', fragment: "QUEUE_HOOK = 'netgain/dist/cli.js'", raison: 'la queue d avant la fusion, donnee du predicat de rupture (tache 2)' },
  { fichier: 'src/engine/install/rupture.ts', fragment: "QUEUE_MCP = 'netgain/dist/mcp/main.js'", raison: 'idem, cote MCP' },
  { fichier: 'src/engine/install/rupture.ts', fragment: 'netgain/src \u2192 src/engine', raison: 'en-tete : le deplacement que les queues datent' },
  { fichier: 'src/engine/install/rupture.ts', fragment: 'netgain/dist \u2192 dist/engine', raison: 'idem' },
  { fichier: 'src/engine/install/rupture.ts', fragment: 'le chemin contient netgain/dist', raison: 'en-tete : la forme ECARTEE, citee pour dire pourquoi' },
  { fichier: 'src/engine/install/rupture.ts', fragment: 'chemin portant netgain/dist', raison: 'en-tete : un des cinq faux negatifs mesures' },

  // FORMES HISTORIQUES RECONNUES, que le produit doit continuer de reconnaitre.
  { fichier: 'src/engine/install/hook-edit.ts', fragment: '/netgain/i.test(command)', raison: 'litteral d expression reguliere, pas un chemin' },
  { fichier: 'src/server/install-hooks.ts', fragment: 'node /abs/.../agent-viz/lib/hook.js', raison: 'une des 4 formes historiques que `isAgentVizHook` doit reconnaitre' },
  { fichier: 'tests/install/hook-edit.test.ts', fragment: "'node C:/vieux/netgain/dist/cli.js router-hook'", raison: 'entree perimee et etrangere DELIBEREE (3 sites)' },
  { fichier: 'tests/install/hook-edit.test.ts', fragment: "'node netgain/dist/cli.js doctor'", raison: 'entree netgain sans router-hook : doit rendre false' },
  { fichier: 'tests/install/hook-edit.test.ts', fragment: "CMD = 'node \"F:/DEV/agent-viz/netgain/dist/engine/cli.js\" router-hook'", raison: 'racine SIMULEE : le test prouve la forme de la commande, pas l adresse de ce depot' },
  { fichier: 'tests/install/mcp-edit.test.ts', fragment: "'F:/DEV/agent-viz/netgain/dist/engine/mcp/main.js'", raison: 'racine SIMULEE, idem' },
  { fichier: 'tests/install/rupture.test.ts', fragment: "AUTRE_RACINE_SANS_QUOTES = 'node C:/vieux/netgain/dist/cli.js router-hook'", raison: 'fixture de la tache 2' },
  { fichier: 'tests/install/rupture.test.ts', fragment: "SOUHAITE_AVANT_FUSION = 'node \"F:/DEV/agent-viz/netgain/dist/cli.js\" router-hook'", raison: 'fixture de la tache 2' },
  { fichier: 'tests/install/rupture.test.ts', fragment: '/netgain/i.test(commande)', raison: 'litteral d expression reguliere' },
  { fichier: 'tests/install/status-rupture.test.ts', fragment: "HOOK_PERIME = 'node C:/vieux/netgain/dist/cli.js router-hook'", raison: 'fixture de la tache 2' },
  { fichier: 'tests/install/status-rupture.test.ts', fragment: "MCP_PERIME = 'C:/vieux/netgain/dist/mcp/main.js'", raison: 'fixture de la tache 2' },
  { fichier: 'tests/install/status-rupture.test.ts', fragment: "HOOK_APRES = 'node C:/vieux/netgain/dist/engine/cli.js router-hook'", raison: 'fixture de la tache 2 : le meme hook, APRES reparation' },
  { fichier: 'tests/install/status-rupture.test.ts', fragment: "MCP_APRES = 'C:/vieux/netgain/dist/engine/mcp/main.js'", raison: 'idem' },
  { fichier: 'tests/install/status-rupture.test.ts', fragment: "'node C:/vieux/netgain/dist/cli.js doctor'", raison: 'entree ETRANGERE : ni hook netgain, ni a reparer' },

  // DONNEES DE TEST — un chemin SIMULE, dont on asserte autre chose que le chemin.
  { fichier: 'tests/unit/install-hooks.test.cjs', fragment: "'node /tmp/agent-viz/lib/hook.js --source=claude'", raison: 'jumeau cote test de la forme historique n 2 : perime EXPRES' },
  { fichier: 'tests/unit/tool-subject.test.mjs', fragment: "file_path: '/home/v/agent-viz/lib/hook.js'", raison: 'chemin simule hors de ce depot : le test asserte le SUJET, pas l adresse' },
  { fichier: 'tests/unit/watchdog-alert-content.test.mjs', fragment: '"session_id" lib/server/observatory --stats', raison: 'commande rg SIMULEE dans un evenement : le test asserte le libelle de l alerte' },
  { fichier: 'tests/unit/watchdog-alert-content.test.mjs', fragment: "file_path: '/repo/lib/hook.js'", raison: 'chemin simule hors de ce depot' },

  // DONNEES DE TEST — arbres ETRANGERS, decouverts par le balayage integral de
  // `netgain/tests` fusionne dans `tests/`. Le plan ne les avait pas releves :
  // son inventaire datait d avant la fusion.
  { fichier: 'tests/doctor/agent-gestures.test.ts', fragment: 'lib/GristServer', raison: 'depot Grist : sujet simule d un geste d agent' },
  { fichier: 'tests/doctor/agent-gestures.test.ts', fragment: 'app/server/lib/DocApi.ts', raison: 'depot Grist, idem' },
  { fichier: 'tests/doctor/agent-gestures.test.ts', fragment: "@/lib/foo", raison: 'alias d un projet tiers, simule' },
  { fichier: 'tests/doctor/turns.test.ts', fragment: 'lib/GristServer', raison: 'depot Grist : sujet simule (3 sites)' },
  { fichier: 'tests/doctor/turns.test.ts', fragment: "@/lib/foo", raison: 'alias d un projet tiers, simule' },
  { fichier: 'tests/map/graph.test.ts', fragment: "alias paths : '@lib/*'", raison: 'sous-projet FIXTURE ecrit dans un tmpdir' },
  { fichier: 'tests/map/graph.test.ts', fragment: '"@lib/*": ["src/lib/*"]', raison: 'le tsconfig de cette fixture' },
  { fichier: 'tests/map/graph.test.ts', fragment: "'lapp/src/lib/util.ts'", raison: 'un fichier de cette fixture (2 sites)' },
  { fichier: 'tests/map/graph.test.ts', fragment: "from '@lib/util'", raison: 'l import qui exerce l alias' },
  { fichier: 'tests/map/graph.test.ts', fragment: '(@lib/*)', raison: 'le nom du test qui l exerce' },
  { fichier: 'tests/map/routes-next.test.ts', fragment: "from '@/lib/response'", raison: 'route Next.js FIXTURE' },

  // RECITS HISTORIQUES DATES — la phrase nomme l adresse d AVANT, et la reecrire
  // la rendrait FAUSSE. Ce ne sont pas des citations perimees : ce sont des
  // citations DE la perimee.
  { fichier: 'tests/repo/documentation-citations.test.mjs', fragment: 'vers `netgain/docs/`', raison: 'constat C7 : un dossier qui n a JAMAIS existe ici — le citer est tout le propos' },
  { fichier: 'docs/sources-externes.md', fragment: 'netgain/docs/calibration-observatoire-m1.md', raison: 'constat C7, idem : l adresse morte que ce fichier existe pour remplacer' },
  { fichier: 'docs/sources-externes.md', fragment: '`netgain/docs/` tant que le moteur y', raison: 'ou vivaient ces documents dans le depot PRIVE, avant le demenagement du moteur' },

  // ARCHITECTURE.md — le document qui RACONTE le deplacement. Les DOUZE entrees
  // ci-dessous nomment l arbre d AVANT pour dire ce qui a bouge et pourquoi ;
  // les reecrire les rendrait fausses, et le document perdrait justement ce
  // qu il a de plus utile a la prochaine etape.
  // Compte verifie par commande, jamais a l oeil — et la commande s ancre sur
  // l indentation d une entree, sinon elle se compterait ELLE-MEME depuis ce
  // commentaire (mesure : 13 au lieu de 12) :
  //   grep -c "^  { fichier: 'ARCHITECTURE" tests/repo/stale-path-citations.test.mjs  -> 12
  { fichier: 'ARCHITECTURE.md', fragment: 'vivaient auparavant dans `lib/`', raison: '§ 2.1 : la fusion a plat des cinq fichiers du haut' },
  { fichier: 'ARCHITECTURE.md', fragment: "`lib/server/` ; l'étape 2 les a fusionnés", raison: '§ 2.1, suite de la meme phrase' },
  { fichier: 'ARCHITECTURE.md', fragment: '`lib/server/**` : un renommage verbatim', raison: '§ 2.1 : ce que la fusion a laisse invariant' },
  { fichier: 'ARCHITECTURE.md', fragment: '"__dirname" 7474f41 -- lib/server', raison: '§ 2.1 : la commande qui compte les 5 traversees, sur l etat d AVANT — elle doit rester rejouable' },
  { fichier: 'ARCHITECTURE.md', fragment: 'lib/server/engine-require.js:25', raison: '§ 2.1 : sa sortie, collee' },
  { fichier: 'ARCHITECTURE.md', fragment: 'lib/server/observatory/engine.js:20', raison: '§ 2.1 : idem' },
  { fichier: 'ARCHITECTURE.md', fragment: 'lib/server/observatory/engine.js:21', raison: '§ 2.1 : idem — deux sites dans un meme fichier, ce qui motive le decompte par SITE' },
  { fichier: 'ARCHITECTURE.md', fragment: "s'atteignait par `../netgain/dist/`", raison: '§ 3 : pourquoi l ancien motif de controle serait MUET aujourd hui' },
  { fichier: 'ARCHITECTURE.md', fragment: '`…/netgain/dist/cli.js` ;', raison: '§ 6 : la queue d avant la fusion que `netgain status` nomme' },
  { fichier: 'ARCHITECTURE.md', fragment: "`lib/`, `public/` et", raison: '§ 8 : les trois racines mortes, nommees comme mortes' },
  { fichier: 'ARCHITECTURE.md', fragment: "`netgain/` n'existent plus", raison: '§ 8, suite de la meme phrase' },
  { fichier: 'ARCHITECTURE.md', fragment: '`netgain/tests/` a rejoint', raison: '§ 9 : la fusion a plat des deux arbres de tests' },

  // FAUX POSITIF ASSUME — un `lib/` VIVANT, sous un arbre que l etape ne touche pas.
  { fichier: 'docs/sources-externes.md', fragment: 'docs/audit/scripts/lib/', raison: '`docs/audit/scripts/lib/` existe : materiel de l audit, hors perimetre du deplacement' },
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

const couvertePar = occ =>
  LISTE_BLANCHE.find(e => e.fichier === occ.fichier && occ.texte.includes(e.fragment));

test('aucune adresse d avant le deplacement ne subsiste hors liste blanche', () => {
  // Arrange
  const toutes = occurrences();

  // Act
  const perimees = toutes.filter(o => !couvertePar(o));

  // Assert — l assiette est dite AVANT le verdict : un balayage qui ne lit
  // rien passerait aussi, et ne prouverait rien.
  assert.ok(toutes.length >= 40, `assiette suspecte : ${toutes.length} occurrences vues, attendu >= 40`);
  assert.deepEqual(
    perimees.map(o => `${o.fichier}:${o.ligne} \u2192 ${o.texte.trim()}`),
    [],
    '`lib/`, `public/` et `netgain/` n existent plus : une citation qui les nomme envoie le lecteur nulle part. ' +
      'La faire suivre le deplacement, ou l inscrire dans LISTE_BLANCHE avec sa raison.',
  );
});

test('chaque entree de la liste blanche protege encore quelque chose', () => {
  // Arrange
  const toutes = occurrences();

  // Act
  const orphelines = LISTE_BLANCHE.filter(
    e => !toutes.some(o => o.fichier === e.fichier && o.texte.includes(e.fragment)),
  );

  // Assert
  assert.deepEqual(
    orphelines.map(e => `${e.fichier} \u2192 ${e.fragment}`),
    [],
    'une entree de liste blanche sans occurrence est une exemption qui a survecu a ce qu elle protegeait : ' +
      'la retirer, sinon elle couvrira un jour une citation neuve.',
  );
});

// \u2500\u2500 D9 \u2014 les citations INTERNES d un ancien nom `*.test.js` \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
//
// Angle mort distinct de D8 : `RACINE_MORTE` guette un DOSSIER mort
// (`lib/`, `public/`, `netgain/`), pas un NOM DE FICHIER qui a change
// d extension. Le step 1 a renomme 39 `.test.js` en `.test.cjs` : une
// citation qui garde encore l ancien nom pointe vers un fichier qui n existe
// plus sous cette adresse, exactement le meme defaut que D8, ici sur
// l extension plutot que sur le dossier.
//
// Deux listes NEUVES, posees PAR-DESSUS `fichiersBalayes()` (reutilise tel
// quel, jamais reimplemente : lui seul porte les exclusions communes — dont,
// jusqu au solde de la dette du 2026-08-13, `tests/CLAUDE.md`). Ni l une ni
// l autre ne touche `EXCLUS` ni `LISTE_BLANCHE` : y ajouter changerait ce que
// les deux tests ci-dessus prouvent (mesure).
const EXCLUS_TEST_JS = [
  // 13 litt\u00e9raux FABRIQU\u00c9S ('a.test.js', 'b.test.js', 'c.test.js' \u2014 jamais
  // touches, Global Constraints) : donnees de test pour `formatId` et le
  // reporter node:test, pas des citations d un fichier reel. Rien a
  // proteger fragment par fragment, le fichier entier est hors sujet.
  'tests/unit/test-ids-format.test.mjs',
];

// Ancre sur un identifiant (lettres/chiffres/tiret/underscore) immediatement
// avant `.test.js` : matche `pricing.test.js`, pas une mention nue comme
// \u00ab 42 `.test.js` \u00bb (ARCHITECTURE.md, table du pont \u00a7 9) \u2014 un DECOMPTE, pas
// la citation d un fichier ; ce nombre est revu au commit de bascule
// (tache 5, qui refait tout le tableau d un coup), pas ici.
const CITATION_TEST_JS = /[A-Za-z0-9_-]+\.test\.js\b/;

const LISTE_BLANCHE_TEST_JS = [
  // PERMANENTE \u2014 ne pourra JAMAIS etre retiree tant que ce filet reste ce
  // filet. Cite ses deux voisins `transcript.test.js` et
  // `transcript-subagents.test.js` par leur nom D AVANT le step 1 ; les
  // Global Constraints interdisent de changer le contenu des 39 `.test.cjs`
  // (\u00ab aucun fichier de test ne change de semantique \u00bb, et corriger cette
  // citation n est pas un `git mv`). L entree protege donc pour toujours
  // une citation FAUSSE et gelee, pas un oubli provisoire a solder \u2014 sauf
  // si doc/36 \u00a7 1.3 levait un jour cet interdit sur le contenu des 39.
  {
    fichier: 'tests/unit/transcript-adapters.test.cjs',
    fragment: '`transcript.test.js` et `transcript-subagents.test.js`',
    raison: 'citation interne perimee par le step 1, gelee : contenu des 39 .test.cjs hors de portee (PERMANENT)',
  },
];

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
  const perimees = toutes.filter(
    o => !LISTE_BLANCHE_TEST_JS.some(e => e.fichier === o.fichier && o.texte.includes(e.fragment)),
  );

  // Assert
  assert.deepEqual(
    perimees.map(o => `${o.fichier}:${o.ligne} \u2192 ${o.texte.trim()}`),
    [],
    'citation d un ancien nom .test.js hors liste blanche : la faire suivre le renommage (step 1), ' +
      'ou l inscrire dans LISTE_BLANCHE_TEST_JS avec sa raison.',
  );

  // Act \u2014 seconde garantie : aucune exemption (EXCLUS_TEST_JS ou
  // LISTE_BLANCHE_TEST_JS) n a survecu a ce qu elle protegeait.
  const exclusOrphelins = EXCLUS_TEST_JS.filter(rel => {
    const abs = path.join(ROOT, rel);
    if (!existsSync(abs)) return true;
    return !readFileSync(abs, 'utf8').split(/\r?\n/).some(l => CITATION_TEST_JS.test(l));
  });
  const blancheOrphelines = LISTE_BLANCHE_TEST_JS.filter(
    e => !toutes.some(o => o.fichier === e.fichier && o.texte.includes(e.fragment)),
  );

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

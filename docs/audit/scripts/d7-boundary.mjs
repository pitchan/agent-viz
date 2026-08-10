// D7 — les gestes réalisés DES DEUX CÔTÉS de la frontière produit/moteur.
//
// CE DÉTECTEUR NE DÉCOUVRE RIEN. Il VÉRIFIE une matrice écrite à la main.
//
// La v1 cherchait ces gestes par motif, et c'était son plus gros défaut : son
// motif `'projects'` ne trouvait aucun site côté serveur, d'où l'on aurait
// conclu « pas de duplication ». La vérité est autre — le serveur reçoit
// `transcript_path` poussé par le crochet, le moteur balaie le dossier — donc
// la bonne réponse était atteinte pour la mauvaise raison. Un instrument juste
// par accident n'est pas un instrument.
//
// Le contrat est inversé : l'humain affirme, le script conteste. La
// vérification échoue si un site déclaré a disparu (la matrice a vieilli) ou si
// un site non déclaré correspond au motif (quelqu'un a ajouté un chemin).
//
// À REMPLIR À L'ÉTAPE 1 DE LA TÂCHE 7, en lisant le code. Les entrées
// ci-dessous sont celles établies pendant la rédaction du plan ; toute autre
// doit être justifiée de la même façon.
//
// LIMITES DE CE DÉTECTEUR, écrites au moment où elles sont acceptées (tâche 7) :
//   1. `verifyMatrix` ne regarde que les zones `server` et `engine` (voir le
//      filtre dans la boucle `sitesInattendus` ci-dessous). Un site qui
//      correspond au motif dans la zone `web` est invisible par construction —
//      ce n'est pas un oubli, c'est le périmètre : D7 surveille la frontière
//      produit/moteur, pas le client web. Exemple mesuré sur ce dépôt :
//      `public/viz-network.js:212` correspond au motif de `decodage-jsonl`
//      (`JSON.parse(line)`) et n'apparaît dans aucune liste déclarée — c'est
//      correct, pas une omission.
//   2. La déclaration se fait par FICHIER, jamais par occurrence. Un fichier
//      qui porte plusieurs sites du même geste (`lib/server/transcript.js` en
//      porte deux pour `decodage-jsonl`, lignes 48 et 74) n'a besoin que d'une
//      seule entrée dans `coteServeur` ou `coteMoteur`. Un TROISIÈME site
//      ajouté dans un fichier déjà déclaré ne serait pas vu.
//   3. Pour un geste dont `motif` vaut `null` (ex. `decouverte-de-sessions`),
//      `sitesInattendus` est toujours vide : sans motif, rien ne peut détecter
//      l'apparition d'un troisième site qui adopterait la même stratégie —
//      seule la disparition d'un site déclaré (`sitesManquants`) est
//      vérifiable. C'est le prix d'un fait qu'aucune expression rationnelle ne
//      capture (« pousser transcript_path » n'est pas un motif textuel).
export const MATRICE = [
  {
    geste: 'decouverte-de-sessions',
    verdict: 'strategies-opposees',
    raison: 'le serveur reçoit transcript_path poussé par le crochet '
      + '(transcript-adapters/claude.js) ; le moteur balaie ~/.claude/projects '
      + '(core/discovery.ts). Ce n’est pas une duplication, et la fusion ne doit '
      + 'pas les confondre.',
    motif: null,
    coteServeur: ['lib/server/transcript-adapters/claude.js'],
    coteMoteur: ['netgain/src/core/discovery.ts'],
  },
  {
    geste: 'resolution-du-dossier-de-configuration',
    verdict: 'duplique',
    raison: 'deux variables d’environnement pour désigner le même dossier dans '
      + 'un seul paquet npm : CLAUDE_CONFIG_DIR côté produit, NETGAIN_CLAUDE_DIR '
      + 'côté moteur. Un utilisateur qui en pose une n’agit que sur une moitié.',
    motif: /CLAUDE_CONFIG_DIR|NETGAIN_CLAUDE_DIR/,
    coteServeur: ['lib/server/observatory/index.js'],
    // cli.ts n'est pas un troisième point de résolution : c'est le texte d'aide
    // qui ANNONCE la variable du moteur (ligne 24). Il est déclaré ici parce
    // que le motif l'atteint, et l'omettre ferait échouer la vérification —
    // ce qui est le comportement voulu : la matrice doit dire toute la vérité.
    coteMoteur: ['netgain/src/doctor/index.ts', 'netgain/src/cli.ts'],
  },
  {
    geste: 'decodage-jsonl',
    verdict: 'duplique',
    raison: 'le moteur a UN module dédié au décodage ligne à ligne, '
      + 'netgain/src/core/jsonl.ts : lecture en flux, BOM retiré, lignes vides '
      + 'sautées, une ligne cassée signalée { ok: false } plutôt qu’avalée. Le '
      + 'serveur réimplémente ce décodage à 8 sites répartis sur 7 fichiers. La '
      + 'tolérance au BOM y est incidente et inégale : lib/server/housekeep.js:33 '
      + 'et lib/server/event-reader.js:120 ne survivent à un BOM que parce '
      + 'qu’ils trim() le buffer entier pour une raison sans rapport — U+FEFF '
      + 'appartient à la production WhiteSpace d’ECMAScript, donc trim() '
      + 'l’enlève, alors que JSON.parse le rejette net ; '
      + 'lib/server/watchdog/catch-up.js:84 et lib/server/watchdog/journal.js:141 '
      + 'ne trim() que pour tester une ligne vide puis parsent la chaîne NON '
      + 'trimmée ; les autres sites ne trim() jamais. Cible : une seule primitive '
      + 'de décodage de ligne, partagée par les différents modes de lecture. Le '
      + 'suivi incrémental de lib/server/transcript.js:199, qui porte un '
      + '`leftover` pour une ligne partielle en suivant un fichier qui grossit, '
      + 'reste spécialisé et ne doit pas y être replié.',
    motif: /JSON\.parse\(\s*(?:line|trimmed|firstLine)\b/,
    coteServeur: [
      'lib/server/transcript.js',
      'lib/server/event-reader.js',
      'lib/server/housekeep.js',
      'lib/server/session-index.js',
      'lib/server/transcript-adapters/claude.js',
      'lib/server/watchdog/catch-up.js',
      'lib/server/watchdog/journal.js',
    ],
    // netgain/src/mcp/main.ts n'a rien à voir avec les transcripts : il décode
    // du JSON-RPC ligne à ligne depuis stdin. Un motif différent, mais le
    // motif l'atteint quand même — déclaré ici pour la même raison que cli.ts
    // dans l'entrée précédente : la matrice dit toute la vérité.
    coteMoteur: ['netgain/src/core/jsonl.ts', 'netgain/src/mcp/main.ts'],
  },
  {
    geste: 'agregation-de-jetons',
    verdict: 'duplique',
    raison: 'les deux côtés accumulent les quatre mêmes champs bruts d’usage '
      + 'avec les mêmes gardes à zéro — accumulateUsage de lib/server/tokens.js '
      + 'et addUsage de netgain/src/doctor/aggregators/tokens.ts. Les DEUX '
      + 'dédupliquent par identifiant de message, et les DEUX seulement quand un '
      + 'identifiant est présent (if (msgId) côté serveur, '
      + 'if (evt.msgId !== null) côté moteur) : il n’y a pas de divergence là — '
      + 'un brouillon précédent de cette matrice en affirmait une, et il a été '
      + 'corrigé. Le moteur suit en plus cacheCreate1h et cacheCreate5m, que le '
      + 'serveur ne suit pas. tokenSum et netTokens sont DEUX métriques '
      + 'DISTINCTES, pas deux implémentations d’un même geste — netTokens est la '
      + 'convention de mesure (cache_read exclu, énoncé comme tel) et tokenSum '
      + 'un total de débogage ; ne pas les présenter comme quelque chose à '
      + 'fusionner. Cible : une seule primitive d’accumulation d’usage, partagée.',
    motif: /cache_creation_input_tokens/,
    coteServeur: [
      'lib/server/observatory/provenance.js',
      'lib/server/pricing.js',
      'lib/server/tokens.js',
    ],
    coteMoteur: [
      'netgain/src/core/events.ts',
      'netgain/src/core/pricing.ts',
      'netgain/src/doctor/aggregators/context.ts',
      'netgain/src/doctor/aggregators/tokens.ts',
      'netgain/src/doctor/aggregators/turns.ts',
    ],
  },
  {
    geste: 'tarification',
    verdict: 'duplique',
    raison: 'l’arithmétique est identique et le mirroring est délibéré — le '
      + 'docblock de netgain/src/core/pricing.ts dit littéralement « Reproduit '
      + 'la formule agent-viz (pricing.js) », et un test de mirroring contrôlé '
      + '(netgain/tests/core/pricing.test.ts) le tient en place. La divergence '
      + 'porte sur le contrat de résultat pour un modèle inconnu, et elle est '
      + 'délibérée en sens opposés : le computeCost de lib/server/pricing.js '
      + 'rend 0 et journalise une fois, quand celui de '
      + 'netgain/src/core/pricing.ts rend { usd: null, known: false } avec la '
      + 'raison énoncée qu’un tarif qu’on ne connaît pas ne s’invente pas. Un '
      + 'seul paquet npm, deux moitiés, une seule session : l’une dit zéro '
      + 'dollar, l’autre dit qu’elle ne sait pas. Cible : unifier le contrat de '
      + 'résultat ET propager l’inconnu jusqu’à l’affichage en direct, pour '
      + 'qu’un utilisateur ne voie jamais un 0 $ silencieux.',
    // Motif suggéré /computeCost/ conservé SANS resserrement : il n'atteint que
    // 4 fichiers au total (2 côté serveur, 2 côté moteur) — définitions,
    // commentaires qui le nomment, import et sites d'appel — un ensemble déjà
    // petit et complet ; le resserrer n'aurait rien changé au constat.
    motif: /computeCost/,
    coteServeur: ['lib/server/pricing.js', 'lib/server/tokens.js'],
    coteMoteur: ['netgain/src/core/pricing.ts', 'netgain/src/doctor/aggregators/tokens.ts'],
  },
];

export function verifyMatrix(files, matrice = MATRICE) {
  const byPath = new Map(files.map(f => [f.path, f]));
  const gestes = matrice.map((entry) => {
    const declares = new Set([...entry.coteServeur, ...entry.coteMoteur]);
    const sitesManquants = [...declares].filter(p => !byPath.has(p)).sort();
    const sitesInattendus = entry.motif
      ? files
        .filter(f => (f.zone === 'server' || f.zone === 'engine')
          && !declares.has(f.path)
          && new RegExp(entry.motif.source, entry.motif.flags).test(f.text))
        .map(f => f.path).sort()
      : [];
    return {
      geste: entry.geste,
      verdict: entry.verdict,
      raison: entry.raison,
      coteServeur: entry.coteServeur,
      coteMoteur: entry.coteMoteur,
      sitesManquants,
      sitesInattendus,
    };
  });
  return { gestes, coherente: gestes.every(g => !g.sitesManquants.length && !g.sitesInattendus.length) };
}

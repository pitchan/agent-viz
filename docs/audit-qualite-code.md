## Constats

Six constats sont retenus, chacun rejouable depuis les résultats de
`docs/audit/resultats/*.json` (régénérables par
`node docs/audit/scripts/run-all.mjs`) ou depuis une lecture directe des
fichiers cités. Plusieurs candidats mesurés par les détecteurs ne figurent
volontairement pas ci-dessous parce qu'ils se sont révélés être des artefacts
de l'instrument plutôt que des défauts du code — l'annexe méthode (tâche 11)
et le rapport de tâche en détaillent la liste.

### C1 — Sur un crochet préfixé d'un BOM, le serveur perd l'événement en silence total

**Fait brut.** `docs/audit/resultats/d3.json`, primitive `lecture-json-de-fichier`,
sites `lib/hook.js` (ligne 46) et `netgain/src/router/hook.ts` (ligne 14) —
les deux fichiers analysent la même charge JSON reçue sur l'entrée standard
d'un crochet (« hook »). Rejouable par `node docs/audit/scripts/run-all.mjs`
pour la localisation, puis par lecture directe des deux fichiers pour le
mécanisme :

- `netgain/src/router/hook.ts:12-14` retire le BOM (« byte order mark »,
  marqueur d'ordre des octets U+FEFF) avant l'analyse, avec un commentaire qui
  nomme la cause et la conséquence : *« un writer Windows (.NET UTF8Encoding)
  le préfixe, JSON.parse le rejette — sans strip, le fail-open désactiverait
  le router EN SILENCE sur ce harnais »*.
- `lib/hook.js:46` ne le retire pas : `const evt = JSON.parse(input);`. Le
  `catch` qui l'entoure, ligne 72, est **vide** (`catch {}`), suivi d'un
  `process.exit(0)` inconditionnel ligne 73, hors du bloc `try`.

Le journal d'erreurs du crochet (`_hook-errors.log`, ligne 54-57) est lui
aussi à l'intérieur du même `try`, mais **après** l'appel à `JSON.parse` : si
l'analyse échoue, ce code n'est jamais atteint. `docs/audit/resultats/d6.json`,
tableau `sansPreuveDExecution`, confirme que `lib/hook.js` n'a par ailleurs
aucune preuve d'exécution dans la suite de tests — aucun test ne couvre ce
chemin d'échec.

**Raisonnement.** Sur un harnais qui préfixe un BOM (le commentaire du moteur
en documente un : un `writer` .NET sous Windows), `JSON.parse` lève, le
`catch` vide l'avale, et le processus sort avec le code 0 — le code de succès.
Résultat : aucun événement écrit dans le `.jsonl` de session, aucune
notification envoyée au serveur, et pas même une ligne dans le journal
d'erreurs qui existe précisément pour ce cas. Rien ne signale que quelque
chose a été perdu. C'est une perte de capture totale et silencieuse, dans un
produit dont la capture des événements est la raison d'être. La même leçon
est apprise et documentée quatre fois côté moteur (`netgain/src/router/hook.ts`,
`netgain/src/core/jsonl.ts:19`, `netgain/src/version.ts:14-16`,
`netgain/src/install/json-file.ts:34`, ce dernier commenté littéralement
« BOM U+FEFF (leçon v0.2.1) »). Un `grep -rl "BOM\|FEFF"` sur `netgain/tests/`
en trouve cinq, mais un seul est étranger au sujet : `netgain/tests/doctor/session-kind.test.ts:108`
contient un caractère `﻿` dans le TEXTE d'un prompt de test (fixture
pour une détection de session sans marqueur humain), sans rapport avec une
tolérance d'analyse JSON — ce n'est pas un test de la leçon BOM. Les quatre
qui le sont : `netgain/tests/core/jsonl.test.ts`, `netgain/tests/install/json-file.test.ts`,
`netgain/tests/router/hook.test.ts`, `netgain/tests/e2e/install.e2e.test.ts`.
Zéro test de cette nature côté serveur. Le mécanisme est démontré par lecture directe du
code (le rejet de `JSON.parse` sur un BOM est un fait du langage, pas une
hypothèse) ; la fréquence à laquelle un BOM atteint réellement ce crochet sur
le parc de machines des utilisateurs n'est pas mesurée par cet audit.

**Cible.** Faire converger `lib/hook.js` vers le traitement déjà correct de
`netgain/src/router/hook.ts` : retirer le BOM avant l'analyse, et surtout ne
plus laisser un échec de `JSON.parse` disparaître sans trace — au minimum,
écrire dans `_hook-errors.log` AVANT de sortir, quelle que soit la cause de
l'échec.

| Impact | Confiance | Coût | Fenêtre | Traitement |
|---|---|---|---|---|
| intégrité de ce qui est conservé | démontré | S | à absorber par la fusion | à corriger |

---

Les trois constats suivants (C2 à C4) portent sur les trois gestes que la
tâche 7 a mesurés comme dupliqués entre `lib/` et `netgain/src/` avec une
cible déjà arbitrée par Vincent. Leur ordre de traitement, à respecter dans
doc/36, est fixé une fois ici : **tests de caractérisation d'abord**, puis
décodeur JSONL commun, puis primitive d'accumulation d'usage, puis contrat de
tarification structuré et affichage honnête. La raison de commencer par les
tests de caractérisation n'est pas un principe abstrait : `docs/audit/resultats/d6.json`,
tableau `limites`, énonce noir sur blanc que « le moteur n'a pas de couverture
d'exécution : atteignabilité statique seulement » — les fichiers TypeScript
de `netgain/src/` que C2, C3 et C4 vont toucher n'ont donc aujourd'hui aucune
preuve d'exécution réelle, seulement une preuve qu'ils sont atteignables.
Toucher ce code sans filet avant la fusion serait déplacer une duplication
non testée vers un seul fichier non testé.

### C2 — Le décodage JSONL est réimplémenté sur 7 fichiers côté serveur, avec une tolérance au BOM incidente et inégale

**Fait brut.** `docs/audit/resultats/d7.json`, geste `decodage-jsonl`,
`verdict: "duplique"` : `coteMoteur` = `netgain/src/core/jsonl.ts` (module
dédié, lecture en flux, BOM retiré, lignes vides sautées, ligne cassée
signalée `{ ok: false }` plutôt qu'avalée) et `netgain/src/mcp/main.ts`
(consommateur du module dédié, pas une réimplémentation) ; `coteServeur` = 7
fichiers (`lib/server/transcript.js`, `event-reader.js`, `housekeep.js`,
`session-index.js`, `transcript-adapters/claude.js`, `watchdog/catch-up.js`,
`watchdog/journal.js`). `docs/audit/resultats/d3.json`, primitive
`decodage-jsonl`, dénombre 11 fichiers distincts et donne les lignes de
chaque site. Rejouable par `node docs/audit/scripts/run-all.mjs`.

**Raisonnement.** Le module dédié du moteur existe déjà et gère correctement
le cas BOM ; le serveur refait ce geste 7 fois, et pas de la même façon.
`lib/server/housekeep.js:33` et `lib/server/event-reader.js:120` ne survivent
à un BOM en tête de fichier que par accident, parce qu'ils appellent
`trim()` sur le tampon entier pour une raison sans rapport (U+FEFF appartient
à la production `WhiteSpace` d'ECMAScript, donc `trim()` l'enlève).
`lib/server/watchdog/catch-up.js:83-86` et `lib/server/watchdog/journal.js:140-147`
ne `trim()` une ligne que pour tester si elle est vide, puis analysent la
chaîne **non retrimée** — vérifié par lecture directe, même forme dans les
deux fichiers, à la variable près (`evt` dans `catch-up.js`, `rec` dans
`journal.js`) : `try { <var> = JSON.parse(line); } catch { continue; }`.
Une première ligne de fichier préfixée d'un BOM y échoue et est sautée en
silence (une seule ligne perdue, pas tout le fichier — plus discret que C1,
mais du même ordre : un jeu de règles de tolérance différent par fichier,
jamais énoncé nulle part comme une politique commune). `lib/server/transcript.js:199`
porte en plus un `leftover` pour suivre un fichier qui grossit (lecture
incrémentale d'un flux en direct) : ce geste est réellement spécialisé et ne
doit pas être replié dans la primitive commune.

**Cible.** Une seule primitive de décodage de ligne (BOM retiré, ligne vide
sautée, ligne cassée signalée plutôt qu'avalée), réutilisée par les
différents modes de lecture. Le suivi incrémental de `lib/server/transcript.js:199`
reste spécialisé et n'y est pas replié.

| Impact | Confiance | Coût | Fenêtre | Traitement |
|---|---|---|---|---|
| intégrité de ce qui est conservé | démontré | L | à absorber par la fusion | à corriger |

### C3 — L'accumulation des jetons d'usage est réimplémentée côté serveur et côté moteur

**Fait brut.** `docs/audit/resultats/d7.json`, geste `agregation-de-jetons`,
`verdict: "duplique"` : `lib/server/tokens.js:50-85` (`accumulateUsage`) et
`netgain/src/doctor/aggregators/tokens.ts:20-27` (`addUsage`, appelée depuis
`TokensAggregator.addAssistant`, lignes 79-104). Rejouable par
`node docs/audit/scripts/run-all.mjs`.

**Raisonnement.** Les deux fonctions accumulent les quatre mêmes champs bruts
d'usage (`input_tokens`, `output_tokens`, `cache_creation_input_tokens`,
`cache_read_input_tokens`) avec les mêmes gardes à zéro, et les deux
dédupliquent par identifiant de message, seulement quand un identifiant est
présent (`if (msgId)` côté serveur, `if (evt.msgId !== null)` côté moteur) —
il n'y a pas de divergence de comportement sur ce périmètre commun. Le moteur
suit en plus `cacheCreate1h` et `cacheCreate5m` (ventilation par fenêtre de
cache), que le serveur ne suit pas : c'est une extension, pas une
divergence. `tokenSum` (`lib/server/tokens.js:45-48`) et `netTokens`
(`netgain/src/doctor/aggregators/tokens.ts:39-41`) sont deux métriques
distinctes par construction (l'un inclut `cacheRead`, l'autre l'exclut par
convention documentée) — elles ne doivent pas être fusionnées en une primitive
unique, seule l'accumulation des champs bruts doit l'être.

**Cible.** Une seule primitive d'accumulation d'usage, partagée par les deux
côtés, portant les six champs (les quatre communs plus les deux ventilations
de cache du moteur) et la même règle de déduplication par identifiant de
message. `tokenSum` et `netTokens` restent deux calculs distincts appliqués
au résultat de cette primitive, pas des cibles de fusion elles-mêmes.

| Impact | Confiance | Coût | Fenêtre | Traitement |
|---|---|---|---|---|
| coût de maintenance seul | démontré | M | à absorber par la fusion | à corriger |

### C4 — Le contrat de tarification pour un modèle inconnu diverge, et le pilote temps réel ne relaie aucune information de coût incomplet

**Fait brut.** `docs/audit/resultats/d7.json`, geste `tarification`,
`verdict: "duplique"`. Lecture directe, en suivant la chaîne d'appel :

- `lib/server/pricing.js:126-159` (`computeCost`) rend `0` pour un modèle
  inconnu et journalise un avertissement une seule fois par modèle
  (`console.error`, serveur uniquement — jamais vu par l'utilisateur).
- `netgain/src/core/pricing.ts:112-133` rend `{ usd: null, known: false, model }`
  — jamais un zéro silencieux, comme le dit son commentaire.
- `netgain/src/doctor/aggregators/tokens.ts:50-63,106-120` calcule
  `costComplete: this.unknown.size === 0` à partir de ce contrat honnête, et
  ce champ traverse `netgain/src/doctor/report/types.ts` (`SessionReport.tokens.costComplete`)
  jusqu'à l'affichage : `public/observatory/format.js:120` (« coût partiel »),
  `public/observatory/analysis-view.js:28` (« partiel »),
  `public/observatory/pricing-view.js:141` (« coût partiel »). Ce chemin passe
  par `lib/server/observatory/engine.js:31-57`, qui importe dynamiquement le
  moteur netgain compilé précisément pour cette raison — son commentaire
  ligne 44-47 dit littéralement viser une unification future du pilote temps
  réel sur la même table.
- `lib/server/tokens.js:77-84` (`accumulateUsage`), à l'inverse, encadre tout
  l'ajustement de coût par `if (price) { … }` : si `getPrice(model, at)` ne
  résout rien, **rien n'est mis à jour** — ni `costUsd`, ni `lastModel`, ni
  `contextMax` — et aucun indicateur de complétude n'existe dans ce bucket.
  `public/viz-state.js:200-201` (`formatCost`) affiche alors `'$0'` sans
  aucune annotation pour toute valeur fausse. À ne pas confondre avec
  `formatUsd` (`public/observatory/format.js:10-12`) : cette fonction-là vit
  du côté Observatoire, l'autre moitié du contraste — elle ne porte pas non
  plus de logique de complétude en elle-même, mais ses appelants (`format.js:120`,
  `analysis-view.js:28`, `pricing-view.js:141`) le peuvent, parce que
  `costComplete` existe et leur est fourni. `formatCost`, côté pilote temps
  réel, n'a rien à recevoir : le bucket qui l'alimente ne porte pas ce champ.

Rejouable par `node docs/audit/scripts/run-all.mjs` pour la localisation du
geste, puis par lecture des fichiers cités pour la chaîne complète.

**Raisonnement.** Le même paquet npm contient donc deux réponses opposées à
« que faire d'un modèle dont on ne connaît pas le tarif ? », et surtout deux
CONSOMMATEURS qui n'ont pas la même honnêteté : la page Observatoire (via le
moteur) sait dire « coût partiel » ; le pilote temps réel (le graphe en
direct, sur `lib/server/tokens.js` et `lib/server/pricing.js`) ne le sait pas
et présente un chiffre en dollars sans réserve, potentiellement inférieur au
coût réel de la session si un message a utilisé un modèle non reconnu. Une
même session peut ainsi afficher un montant sans réserve dans une vue et un
montant marqué incomplet dans l'autre. Le mécanisme (deux contrats, un chemin
honnête, un chemin muet) est démontré par lecture directe du code ; la
fréquence à laquelle un modèle réellement inconnu apparaît dans une session
en cours n'est pas mesurée ici — mais le fait que le projet liste de
nouvelles entrées datées dans `lib/server/pricing.js` (catalogue Claude 5)
montre que l'apparition de modèles non encore catalogués est un événement
réel du cycle de vie du produit, pas un cas d'école.

**Cible.** Unifier le contrat de résultat de tarification pour un modèle
inconnu (adopter partout la forme structurée `{ usd: null, known: false }`,
jamais un zéro silencieux) ET propager cette information jusqu'à l'affichage
en direct, pour qu'un utilisateur du pilote temps réel ne voie jamais un
montant sans réserve quand il est en réalité incomplet.

| Impact | Confiance | Coût | Fenêtre | Traitement |
|---|---|---|---|---|
| exactitude de ce que voit l'utilisateur | démontré | M | à absorber par la fusion | à corriger |

### C5 — Deux variables d'environnement désignent le même dossier de configuration

**Fait brut.** `docs/audit/resultats/d7.json`, geste
`resolution-du-dossier-de-configuration`, `verdict: "duplique"`. Lecture
directe : `lib/server/observatory/index.js:24` —
`process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')` ;
`netgain/src/doctor/index.ts:112` —
`cli.claudeDir ?? process.env['NETGAIN_CLAUDE_DIR'] ?? path.join(homedir(), '.claude')`.
Rejouable par `node docs/audit/scripts/run-all.mjs`.

**Raisonnement.** `CLAUDE_CONFIG_DIR` côté produit (serveur, page
Observatoire), `NETGAIN_CLAUDE_DIR` côté moteur : deux noms différents pour
désigner le même dossier, dans un seul paquet npm publié. Un utilisateur qui
pose l'une des deux variables — parce qu'il a lu la documentation de l'une ou
de l'autre moitié du produit — ne change le comportement que de la moitié
correspondante. Le serveur continuerait de scanner `~/.claude` pendant que le
moteur scannerait le dossier personnalisé, ou l'inverse : deux vues du même
produit sur deux jeux de sessions différents, sans qu'aucun message
n'avertisse de l'écart.

**Cible.** Une seule variable d'environnement pour désigner ce dossier,
lue au même endroit par les deux chemins de code.

| Impact | Confiance | Coût | Fenêtre | Traitement |
|---|---|---|---|---|
| exactitude de ce que voit l'utilisateur | démontré | S | à absorber par la fusion | à corriger |

### C6 — Trois clients HTTP côté navigateur

**Fait brut.** `docs/audit/resultats/d3.json`, primitive `appel-http-client` :
`public/observatory/api.js`, `public/viz-network.js` et
`public/viz-watchdog-client.js` en zone web (3 des 7 fichiers distincts
recensés par la primitive, les 4 autres étant des appels HTTP côté serveur
Node, un geste différent). `docs/audit/resultats/d4.json`, tableau
`importsDIO`, confirme que ce sont exactement les 3 entrées de zone `web`
(`modules: ["(fetch global)"]`). Rejouable par
`node docs/audit/scripts/run-all.mjs`.

**Raisonnement.** `public/observatory/api.js:5-24` expose déjà `getJson` et
`postJson` avec une gestion d'erreur qui transforme un statut HTTP non-OK en
`Error` lisible. `public/viz-network.js` (lignes 187, 200, 227, 329) appelle
`fetch(...)` directement à quatre endroits, sans passer par `api.js` ni
refaire de gestion d'erreur homogène. `public/viz-watchdog-client.js:49`
déclare son propre alias `_fetch` — un point d'injection pour les tests, pas
un traitement d'erreur partagé. Trois chemins pour un même geste, sans raison
qui les distingue : une correction de robustesse (ajout d'un timeout, d'une
nouvelle tentative, d'un message d'erreur uniforme) n'atteindrait qu'un tiers
du code si elle n'est faite que dans un des trois fichiers.

**Cible.** Un seul client HTTP, importé par les trois fichiers.

| Impact | Confiance | Coût | Fenêtre | Traitement |
|---|---|---|---|---|
| coût de maintenance seul | démontré | S | à absorber par la fusion | à corriger |

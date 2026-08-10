# Audit de qualité de code — agent-viz

**Commit des sources audité :** `4a4dc46` (v0.12.1)
**Commit de l'outillage d'audit :** voir `commitOutils` dans chaque résultat
(`docs/audit/resultats/*.json`) — il avance à chaque tâche du plan, le commit
des sources ne bouge pas ; les deux numéros sont stockés séparément et ne se
confondent jamais.
**Fichiers non suivis à l'ouverture :** `tests/CLAUDE.md` (préexistant,
2026-08-09 11:25) — seule exception ; tout autre fichier non suivi est un
défaut de procédure.
**Node :** v24.15.0 · **audité le :** 2026-08-10
**Périmètre :** `lib/` `bin/` `public/` `netgain/src/` — **17 445 lignes,
113 fichiers** (48 `server`, 25 `web`, 40 `engine`), **108 873 jetons**.
Chiffres **mesurés** par `sources()` (`docs/audit/scripts/lib/source-files.mjs`)
et `tokenize` (`docs/audit/scripts/lib/tokens.mjs`) contre le dépôt réel à ce
commit — pas recopiés du plan qui a préparé cet audit, qui annonçait 17 332
lignes et 109 762 jetons à titre d'estimation de rédaction. L'écart est
expliqué dans l'annexe méthode.
**Exclus :** `netgain/dist/` (généré), `node_modules/`, `tests/fixtures/`,
`docs/` (l'audit ne s'audite pas lui-même)
**Rejouable :** `node --test "docs/audit/scripts/**/*.test.mjs"` puis
`node docs/audit/scripts/run-all.mjs --comparer`
**Qualification préparée par :** Claude — **NON SIGNÉE** (voir tâche 12)

## Verdict d'une page

Six constats, classés par rang puis par confiance décroissante. Les six
portent une confiance « démontré » (aucun n'est resté au stade « probable »
ou « hypothèse ») ; à confiance égale, l'ordre suit le numéro de constat.

| # | Constat | Rang | Confiance | Coût | Fenêtre |
|---|---|---|---|---|---|
| C1 | Perte de capture totale et silencieuse sur un crochet préfixé d'un BOM | P0 | démontré | S | à absorber par la fusion |
| C2 | Décodage JSONL réimplémenté sur 7 fichiers serveur, tolérance BOM incidente et inégale | P1 | démontré | L | à absorber par la fusion |
| C4 | Contrat de tarification divergent : pilote temps réel muet, Observatoire honnête | P1 | démontré | M | à absorber par la fusion |
| C5 | Deux variables d'environnement pour un seul dossier de configuration | P1 | démontré | S | à absorber par la fusion |
| C3 | Accumulation des jetons d'usage dupliquée entre serveur et moteur | P2 | démontré | M | à absorber par la fusion |
| C6 | Trois clients HTTP côté navigateur | P2 | démontré | S | à absorber par la fusion |

**Rangs (doc/34) :** P0 défaut démontré affectant ce que l'utilisateur voit ou
conserve · P1 divergence utilisateur démontrée ou très probable · P2 dette
structurelle avec coût observable ou pression de changement · P3 amélioration
souhaitable sans risque immédiat.

**Comment le rang a été assigné, et une inconsistance signalée plutôt que
lissée.** Les trois axes que chaque fiche publie déjà (impact, confiance,
coût) ne suffisent pas, seuls, à séparer P0 de P1 : **C1 et C2 partagent
exactement le même impact** (« intégrité de ce qui est conservé ») **et la
même confiance** (« démontré ») **dans leur propre tableau, et ne peuvent
pourtant pas porter le même rang.** C'est l'inconsistance que ce rapport
choisit de nommer plutôt que de dissoudre en silence. Le départage retenu
s'appuie sur un quatrième critère, réel dans la matière mais absent des trois
axes publiés par la spec : C1 est un défaut autonome, trouvé **hors** de la
matrice D7 (un manquement de conformité de protocole sur la lecture d'un
crochet, pas un des cinq gestes métier que D7 recense), qui casse une
garantie absolue — aucun événement ne devrait jamais disparaître — sans
condition d'un second système auquel se comparer : c'est un **défaut**. C2,
C4 et C5 proviennent tous les trois d'un verdict `duplique` de D7 : deux
implémentations existent, désaccordent, et le rapport ne tranche pas
laquelle est « la bonne » sans arbitrage humain séparé : c'est une
**divergence**. C3 et C6 partagent un impact « coût de maintenance seul »,
qui n'entre dans la définition ni de P0 ni de P1 et place directement en P2.
Aucun constat ne descend en P3 : les six portent un coût de correction
chiffré (S/M/L) et une fenêtre déjà fixée (« à absorber par la fusion »),
signe qu'aucun n'est jugé sans risque à ignorer.

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
signalée `{ ok: false }` plutôt qu'avalée) et `netgain/src/mcp/main.ts` — ce
second fichier n'importe ni ne mentionne `jsonl` nulle part (`grep -rn "jsonl"
netgain/src/mcp/` ne renvoie rien) ; il décode du JSON-RPC ligne à ligne
depuis l'entrée standard, un protocole sans rapport avec les transcripts, et
ne figure ici que parce que le motif de détection l'atteint aussi — la
matrice de D7 déclare tout ce que le motif touche, pas seulement ce qui sert
le récit ; `coteServeur` = 7
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
`coteMoteur` liste aussi `netgain/src/cli.ts` : ce n'est pas un troisième
point de résolution mais le texte d'aide qui ANNONCE la variable du moteur
(ligne 24, une chaîne de documentation) — il figure là seulement parce que
le motif de détection l'atteint aussi. Rejouable par
`node docs/audit/scripts/run-all.mjs`.

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

## Ce qui est sain

Un rapport qui ne liste que des défauts ment par omission (doc/34), et des
développeurs le sentent. Huit réponses « c'est sain » suivent, chacune avec
sa preuve exécutable.

### Le miroir tarifaire de `lib/server/pricing.js`

Niveau D2 : `miroir-controle` — la copie est assumée et tenue par un test qui
casse en cas de divergence, `tests/unit/pricing-engine-mirror.test.js`,
rejouable seul, sans tube :

```
$ node --test tests/unit/pricing-engine-mirror.test.js
✔ FALLBACK mirrors the engine table: rates, labels, context windows, dated periods
✔ switching the price source to the engine table changes no amount
ℹ tests 2
ℹ pass 2
ℹ fail 0
```

**C'est ici que se loge le plus gros artefact de mesure de tout l'audit, et
il doit être dit sans détour.** `docs/audit/resultats/d2.json` recense dix
modèles `claude-*` à `valeursDistinctes: 2` — dix candidats qui, lus tels
quels, ressemblent à dix divergences tarifaires entre le serveur et le
moteur. Il n'y en a aucune. Les quatre taux (`input`, `output`,
`cacheCreate`, `cacheRead`) ET `maxInput` s'accordent sur les dix modèles,
vérifié à la main puis confirmé par le test ci-dessus. La cause est un
artefact d'extraction : `netgain/src/core/pricing.ts` range les taux dans un
littéral `PRICES` et le plafond de contexte dans un second littéral
`MODEL_INFO`, là où `lib/server/pricing.js` réunit tous les champs sous une
seule clé ; le détecteur D2 ne lit qu'un littéral d'objet à la fois, et
l'occurrence de `MODEL_INFO` n'apporte qu'un seul champ que l'extracteur sait
reconnaître (`maxInput` — `label` n'en fait pas partie), tombe sous son seuil
de deux champs et se trouve écartée. Dix « divergences » qui n'en sont
aucune : une table scindée en deux littéraux, lue par un instrument qui n'en
voit qu'un à la fois.

### Le contrat des adaptateurs de transcript (Liskov)

`tests/unit/transcript-adapters.test.js`, dont l'en-tête dit littéralement
*« Liskov is enforced here, not by inheritance »* (« Liskov est appliqué ici,
pas par héritage ») :

```
$ node --test tests/unit/transcript-adapters.test.js
✔ every adapter honors the same contract (Liskov)
✔ getAdapter: null/undefined defaults to claude (pre-0.2.0 sessions)
✔ getAdapter: unknown string logs an error and returns claude (loud fallback)
✔ copilot adapter declares tokens unsupported and parseUsageLine is a no-op
ℹ tests 4
ℹ pass 4
ℹ fail 0
```

Chaque adaptateur de `TRANSCRIPT_ADAPTERS` doit exposer le même jeu de champs
avec les mêmes types : `tokensSupported` (booléen), `discoverPath` et
`parseUsageLine` (fonctions). La différence de taille entre les deux
adaptateurs livrés (`claude.js`, 76 lignes ; `copilot.js`, 13 lignes) n'est
pas un signal de contrat bâclé : Copilot n'expose pas les jetons d'usage et
le déclare (`tokensSupported: false`) plutôt que de mentir sur un contrat
qu'il n'honore pas — son `parseUsageLine` n'a rien à faire.

### Les seuils R1–R6, centralisés et documentés

`lib/server/observatory/rules/thresholds.js` porte les six seuils des règles
de l'Observatoire dans un seul objet gelé (`Object.freeze`), chacun annoté de
son origine :

| Règle | Seuil | Origine |
|---|---|---|
| R1 | `minShareOfNet = 0.20` | `calibration` |
| R2 | `minLoadedShare = 0.5`, `maxUsedShare = 0.1` | `spec` |
| R3 | `minShareOfToolBytes = 0.05`, `minCount = 5` | `calibration` |
| R4 | `minShareOfReadBytes = 0.05`, `minBytes = 100*1024` | `calibration` |
| R5 | `minCompactions = 2` | `spec` |
| R6 | `maxDurationMs = 5*60*1000`, `minSubagentShare = 0.3` | `spec` |

`calibration` renvoie à un document daté
(`netgain/docs/calibration-observatoire-m1.md`, 2026-07-27, 1695 sessions sur
14 projets) qui enregistre la distribution observée et la raison de chaque
valeur retenue — le fichier note même l'écart avec la première proposition
du plan pour R1 (0,05 → 0,20, pour ne jamais dépasser la moitié des projets
déclenchés). `spec` renvoie à doc/12 §7 : la changer, c'est changer la
spécification. Zéro candidat `seuil-de-regle` n'est ressorti de D2 —
cohérent avec des seuils déjà centralisés en un seul fichier plutôt que
recopiés ailleurs.

### La découverte de sessions : deux stratégies opposées, assumées

`docs/audit/resultats/d7.json`, geste `decouverte-de-sessions`,
`verdict: "strategies-opposees"` — **pas** `"duplique"`. Le serveur reçoit
`transcript_path` poussé par le crochet
(`lib/server/transcript-adapters/claude.js`) ; le moteur balaie
`~/.claude/projects` de son propre chef (`netgain/src/core/discovery.ts`).
Ce sont deux mécanismes différents pour la même fin, choisis pour des
raisons d'architecture différentes — le serveur vit en tâche de fond et
attend d'être notifié, le moteur tourne en ligne de commande et n'a personne
pour le notifier. La fusion doit préserver les deux, pas en éliminer un au
profit de l'autre.

### 27 imports d'E/S, 27 adaptateurs, 0 règle métier

`docs/audit/resultats/d4.json`, tableau `importsDIO` : 27 fichiers importent
directement `fs`, `http`, `https`, `child_process` ou `fetch` — 15 côté
serveur, 3 côté web, 9 côté moteur. Le détecteur ne juge rien (« la liste des
modules important `fs`, `http` ou `https` n'est PAS une liste de violations »
— en-tête de `d4-import-graph.mjs`) ; la passe humaine de la tâche 10 a
examiné les 27 un par un et n'a trouvé aucune exception : points d'entrée et
racines de composition (`lib/hook.js`, `lib/server.js`, `bin/agent-viz.js`…),
installateurs, lecteurs et gestionnaires de transcripts dont la lecture EST
le métier, clients HTTP dont `fetch` est le métier, résolveurs de chemin.
`nonResolus` (`lib/server/observatory/engine.js` → `../../../package.json`,
1 entrée) est structurel — le `.json` est hors du jeu d'extensions résolues
— et n'affecte aucune conclusion : le seul cycle réel du dépôt
(`public/viz-network.js` ↔ `public/viz-ui.js`) est intra-zone et déjà connu
du code lui-même. Une frontière entrée/sortie contre logique correctement
tenue, vérifiée fichier par fichier plutôt que supposée.

### Seulement 4 duplications textuelles distinctes, aucune promue en fiche

`docs/audit/resultats/d1.json` mesure 7 groupes de clones, 0 inter-zone. Deux
familles s'effondrent en une seule duplication réelle chacune, une fois
relues ligne à ligne : `54c3cb0e` + `b8d75264` + `b88f4326`
(`lib/lifecycle.js` / `lib/server.js`, le même idiome de fermeture de
requête HTTP capturé à trois offsets de fenêtre voisins) → **1** ;
`e1493e97` + `3a8fe126` (`netgain/src/map/env.ts` / `netgain/src/map/routes.ts`,
la même remontée `enclosingClass` byte-identique, capturée à deux décalages
de fenêtre voisins) → **1**. Les deux groupes restants (`c4c41252`, règles
`r5-compactions.js` / `r6-short-subagents.js` ; `0d718902`,
`context.ts` / `tokens.ts`) sont isolés, sans second groupe à fusionner avec
eux. Total : **4 duplications textuelles distinctes**, toutes intra-zone,
6 à 17 lignes chacune — trop minces à côté des six constats retenus (le
terrain inter-zone, à bien plus fort enjeu, est déjà couvert par C2 à C5,
issus de D7) pour justifier une fiche séparée.

### Open/Closed : dix codes d'événement répétés, zéro aiguillage à rouvrir

Les dix candidats `code-d-evenement` de D2 (`session`, `agent`, `assistant`,
`stuck`, `user`, `alert`, `status`, `badInvocation`, `skill`, `mcp` —
`valeursDistinctes: 1` partout) auraient pu annoncer un répartiteur central
fragile, qu'ajouter un type d'événement forcerait à rouvrir. Lecture
directe : `public/viz-canvas.js`, `viz-layout.js`, `viz-narrator.js` et
`viz-ui.js` branchent chacun sur le même `n.type`, mais aucun répartiteur
central unique n'existe — quatre fichiers indépendants, chacun avec sa
propre responsabilité déjà établie (dessin du nœud, mise en page, texte de
narration, comptage pour l'UI). Ajouter un type oblige à toucher les quatre,
mais chaque édition est justifiée par la responsabilité propre du fichier,
jamais par la réouverture d'un aiguillage partagé. La duplication littérale
reste réelle comme défaut DRY (dix chaînes recopiées sans constante
partagée) mais n'est pas un défaut d'architecture.

### Interface Segregation : `SessionReport` ne fait subir sa largeur à personne

`netgain/src/doctor/report/types.ts:11-38` : 20 champs (19 obligatoires plus
1 optionnel, `skipped?`), composés de types nommés et étroits par
sous-domaine (`ContextStats`, `PromptsStats`, `ReadStats`, `SessionKind`,
`SubagentStats`, `TokensResult`, `ToolResultStats`, `TurnsStats`), chacun
défini et consommé indépendamment par son propre agrégateur. Les seuls
consommateurs du type complet (`report/terminal.ts`, `report/json.ts`) sont
des rendus qui ont légitimement besoin de la totalité du rapport — aucun
consommateur étroit ne subit la largeur d'un type dont il n'utiliserait
qu'une fraction.

## Annexe méthode

### Rejouer l'audit

```
node --test "docs/audit/scripts/**/*.test.mjs"
node docs/audit/scripts/run-all.mjs
node docs/audit/scripts/run-all.mjs --comparer
```

La première commande lance les contrôles unitaires des sept détecteurs
(`d1` à `d7`) plus la vérité terrain. La deuxième régénère les sept fichiers
de `docs/audit/resultats/*.json` (et `couverture.lcov`). La troisième
régénère puis compare au résultat déjà committé, champs volatils
(`commitOutils`, `genereLe`, `nonSuivis` et la liste `CLES_VOLATILES` de
`write-result.mjs`) exclus de la comparaison, et sort en code 1 au premier
écart — **elle régénère et laisse donc l'arbre de travail sale** ; restaurer
`docs/audit/resultats/` avant de committer quoi que ce soit d'autre.

### Budget de faux positifs assumé (doc/34)

D1 groupe ses candidats de clones par empreinte 32 bits avant de les
confirmer par comparaison exacte de la séquence de jetons — jamais par le
hachage seul. Le chiffre qui motive cette étape intermédiaire, tel qu'écrit
en tête de `d1-clones.mjs` : le périmètre produit **103 192 fenêtres** de 60
jetons, et sur une empreinte 32 bits l'espérance de collisions est de
**1,2** — un groupe de clones inventé de toutes pièces suffirait à
discréditer tout le rapport, sans qu'on sache lequel. La comparaison exacte
de séquence lève cette probabilité résiduelle à zéro par construction : une
collision de hachage sans identité de séquence tombe dans un seau qui ne
produit alors aucun groupe commun.

### Limites de `docs/audit/resultats/d6.json` (bloc `limites`, verbatim)

> - Un chargement dynamique (import() calculé, VM, processus enfant) échappe aux deux mesures.
> - Le moteur n'a pas de couverture d'exécution : atteignabilité statique seulement.
> - Un fichier « sans preuve d'exécution » n'est PAS un fichier non testé.

### Limites des détecteurs (en-têtes, verbatim)

Recopiées sans reformulation depuis l'en-tête de chaque script cité.

**`lib/tokens.mjs`** (alimente D1 et D5) :

> LIMITE ASSUMÉE (doc/34), toujours vraie : découpage par expression
> rationnelle, pas par analyseur syntaxique — les identifiants sont conservés
> tels quels, donc un clone dont les variables ont été renommées n'est PAS
> détecté.
>
> DEUX AMBIGUÏTÉS RÉSIDUELLES, NON RÉSOLUES PAR CONSTRUCTION — aucune des
> deux n'est LA seule, toutes deux sont écrites :
>
>   1. Le cas de `}` : `{}` peut fermer un bloc — une regex suit alors
>      presque toujours — ou un littéral objet, valeur qu'une division peut
>      suivre. `}` n'est PAS dans la classe qui bloque la regex : par
>      défaut, un `/` après `}` est traité comme une regex. Choix assumé :
>      fermer un bloc (fonction, `if`, boucle) est infiniment plus fréquent
>      en code réel que diviser un littéral objet, et le reste du dépôt ne
>      contient aucun cas du second type.
>   2. Une DIVISION qui suit IMMÉDIATEMENT une regex SANS DRAPEAU (trouvé par
>      la revue, 2026-08-10). Une regex sans drapeau se termine par un `/`
>      nu ; la lookbehind disqualifiante ne reconnaît que `)`, `]`, une fin
>      de nombre ou une fin d'identifiant comme fin de VALEUR — pas ce `/`
>      final. La division qui suit est donc lue comme ouvrant une SECONDE
>      regex, qui avale tout jusqu'au prochain `/` littéral. Reproduit :
>      `const r = /re/ / 2; const s = 10 / 5;` tokenise en
>      `["const","r","=","/re/","/ 2; const s = 10 /","NUM",";"]` — le
>      deuxième `/` de `/re/` combiné à celui de la division fabrique une
>      fausse regex qui avale `2; const s = 10 ` en entier. Corollaire
>      vérifié : une regex AVEC drapeau est saine, car la lettre du drapeau
>      se lit comme un pseudo-identifiant et disqualifie le `/` suivant.
>      VÉRIFIÉ ABSENT de ce dépôt à ce commit (642 portées D5 stables,
>      `d1.json` identique au jeton près, 0 fichier déséquilibré sur 113
>      après le correctif de cette même tâche) : c'est une limite NOMMÉE, pas
>      un défaut vivant. Non corrigée — chaque changement du socle coûte un
>      nouveau cycle D1/D5 et une revue, pour un cas absent de ce corpus.

**`d1-clones.mjs`** :

> LIMITES ASSUMÉES : ne voit ni les clones à identifiants renommés (les
> identifiants ne sont pas neutralisés), ni les clones INTRA-fichier (un
> groupe exige au moins deux fichiers distincts), ni les clones qui
> traversent les langages — c'est le rôle de D7.

**`d2-truth-sources.mjs`** :

> HORS PORTÉE, ET C'EST VOULU : « deux noms différents pour le même rôle »
> (CLAUDE_CONFIG_DIR contre NETGAIN_CLAUDE_DIR) est invisible à D2 par
> construction, puisque les clés diffèrent. Ce constat appartient à la
> matrice de D7.
>
> LIMITE ASSUMÉE : extraction par expression rationnelle sur des littéraux
> d'objet à un niveau d'imbrication. Une table construite par calcul échappe
> à la mesure ; aucune n'existe dans ce dépôt au commit audité.
>
> DEUX LIMITES CONSTATÉES EN COURANT SUR CE DÉPÔT, écrites ici au moment où
> elles sont acceptées :
>   1. TABLE SCINDÉE = FAUSSE DIVERGENCE. L'extraction ne lit qu'un littéral
>      d'objet à la fois. `netgain/src/core/pricing.ts` range les taux dans
>      `PRICES` et le plafond de contexte dans `MODEL_INFO`, là où
>      `lib/server/pricing.js` réunit tous les champs sous une seule clé.
>      L'occurrence de `MODEL_INFO` n'apporte qu'un champ reconnu, tombe sous
>      le seuil de deux et se trouve écartée. Les dix modèles ressortent donc
>      à `valeursDistinctes: 2` alors que les deux fichiers s'accordent sur
>      les quatre taux ET sur `maxInput`. Vérifié à la main le 2026-08-10.
>   2. IMBRICATION = OMISSION SILENCIEUSE. `[^{}]{0,400}` interdit toute
>      accolade interne. `claude-sonnet-5` est la seule entrée de `FALLBACK`
>      qui porte un champ `history` imbriqué : elle n'est pas vue côté
>      serveur, donc n'a plus qu'une seule définition, donc disparaît des
>      candidats. Une omission ne laisse aucune trace dans le résultat —
>      c'est la raison d'être de cette ligne.

**`d3-many-paths.mjs`** :

> LIMITE ASSUMÉE : ces motifs sont syntaxiques. Un formatage écrit autrement
> (Intl, bibliothèque tierce) passerait au travers — aucun n'existe dans ce
> dépôt au commit audité, et c'est précisément ce que dit le constat sur les
> conventions numériques.
>
> LIMITE CORRIGÉE À L'EXÉCUTION (2026-08-10) : le motif formatage-monetaire
> attrapait à l'origine toute interpolation de gabarit — sa branche
> guillemet-puis-`$` (``['"`]\s*\$``) matchait aussi bien un backtick suivi de
> `${` que le `$` d'un vrai montant. Le premier run réel a montré 225 sites
> sur 247 relevant de cette confusion. Une lookahead négative `(?!\{)` a été
> ajoutée aux deux alternatives où le `$` peut être un sigil d'interpolation
> (la 2ᵉ et la 4ᵉ) ; la 1ʳᵉ et la 3ᵉ, où le `$` précède le guillemet ou suit
> `USD`, n'avaient pas ce problème et sont inchangées. LIMITE RESTANTE,
> vérifiée : un `$` nu suivant un guillemet est toujours pris pour une devise
> qu'il en soit une ou non ; et un formatage monétaire écrit sans `$` ni
> `USD` reste invisible à cette famille.

*Note du rapport (correction différée depuis la tâche 3) : la phrase
ci-dessus, recopiée verbatim, décrit la 3ᵉ alternative comme un cas où
« le `$` … suit `USD` ». C'est inexact : la 3ᵉ alternative est `\bUSD\b`
seule, elle ne contient aucun `$`. Formulation exacte : la 1ʳᵉ, où le `$`
précède le guillemet, et la 3ᵉ, qui ne contient aucun `$` (le mot `USD` seul
suffit), n'avaient pas le problème d'interpolation et sont restées
inchangées. L'instrument n'est pas en cause — seule cette phrase de
commentaire l'était.*

**`d4-import-graph.mjs`** :

> `nonResolus` existe pour une raison précise : un spécificateur relatif que
> la résolution rate disparaît du graphe, et l'absence de cycle devient alors
> un FAUX NÉGATIF invérifiable. On publie donc les ratés — un rapport qui
> annonce « aucun cycle » sans dire combien d'arêtes il n'a pas vues ment par
> omission.
>
> Ce qui reste NON couvert, faute d'usage constaté pour le justifier :
> `usesFetch` teste le texte BRUT, pas neutralisé — un `fetch(` écrit dans un
> commentaire fabriquerait un import d'E/S fantôme exactement sur le même
> principe. Mesuré sur ce dépôt à ce commit : aucun cas (`fetch(` n'apparaît
> jamais UNIQUEMENT dans un commentaire) — c'est donc une zone aveugle non
> déclenchée, pas un défaut corrigé. Par ailleurs la première alternative de
> `SPEC` (`import|export ... from ...`) utilise `[^'"()]*?` qui franchit
> toujours les retours à la ligne : une construction inhabituelle en code
> réel (pas en commentaire) pourrait en principe encore faire pont entre deux
> instructions distinctes.
>
> Ce qui reste : l'heuristique regex-vs-division reprend celle de
> `lib/tokens.mjs` telle quelle, y compris son ambiguïté résiduelle assumée
> sur `}`. Un risque distinct, plus grave, a aussi été soulevé par relecture :
> un `/*` littéral À L'INTÉRIEUR d'une classe de caractères d'une regex
> (ex. `/[/*]/`) pourrait, si l'heuristique classe par erreur cette position
> comme une division, être lu par l'alternative de commentaire de BLOC comme
> une ouverture réelle — celui-là BLANCHIRAIT du code réel et pourrait donc
> faire perdre une arête, contrairement au guillemet non apparié qui n'en
> fait jamais perdre. VÉRIFIÉ ABSENT de ce dépôt (recherché sur les
> 113 fichiers : aucune classe de caractères de regex ne contient de
> séquence `/*` littérale) — risque nommé, non rencontré, non couvert par un
> contrôle automatisé.
>
> Autre limite constatée : un spécificateur relatif qui vise un fichier réel
> mais d'une extension hors périmètre (`.js`/`.mjs`/`.ts` seulement — voir
> `lib/source-files.mjs`) ne résout jamais et finit dans `nonResolus` sans
> être une faute de frappe. Constaté sur
> `lib/server/observatory/engine.js` → `../../../package.json`.

**`d5-volumetry.mjs`** :

> LA MÉTRIQUE PORTE SON PÉRIMÈTRE DANS SON NOM : `fonctionsMotCleFunction`.
> Elle ne compte QUE les déclarations par le mot-clé `function`, imbriquées
> comprises. Les fonctions fléchées et les méthodes de classe ou d'objet en
> sont absentes. La v1 appelait ça « fonctions » tout court, ce qui laissait
> croire à une couverture qu'elle n'avait pas.
>
> Ce qui RESTE vrai après le correctif du socle : D5 hérite de toute limite
> résiduelle de `lib/tokens.mjs` (voir son en-tête pour le détail, non
> dupliqué ici) — l'ambiguïté de `}` non résolue par construction, le
> mot-clé contextuel `of` délibérément non couvert, ET une division qui suit
> immédiatement une regex SANS DRAPEAU. Aucun de ces cas n'a été mesuré dans
> ce dépôt à ce commit.

**`d7-boundary.mjs`** :

> LIMITES DE CE DÉTECTEUR, écrites au moment où elles sont acceptées
> (tâche 7) :
>   1. `verifyMatrix` ne regarde que les zones `server` et `engine`. Un site
>      qui correspond au motif dans la zone `web` est invisible par
>      construction — ce n'est pas un oubli, c'est le périmètre : D7
>      surveille la frontière produit/moteur, pas le client web. Exemple
>      mesuré sur ce dépôt : `public/viz-network.js:212` correspond au motif
>      de `decodage-jsonl` (`JSON.parse(line)`) et n'apparaît dans aucune
>      liste déclarée — c'est correct, pas une omission.
>   2. La déclaration se fait par FICHIER, jamais par occurrence. Un fichier
>      qui porte plusieurs sites du même geste (`lib/server/transcript.js`
>      en porte deux pour `decodage-jsonl`, lignes 48 et 74) n'a besoin que
>      d'une seule entrée dans `coteServeur` ou `coteMoteur`. Un TROISIÈME
>      site ajouté dans un fichier déjà déclaré ne serait pas vu.
>   3. Pour un geste dont `motif` vaut `null` (ex.
>      `decouverte-de-sessions`), `sitesInattendus` est toujours vide : sans
>      motif, rien ne peut détecter l'apparition d'un troisième site qui
>      adopterait la même stratégie — seule la disparition d'un site déclaré
>      (`sitesManquants`) est vérifiable. C'est le prix d'un fait qu'aucune
>      expression rationnelle ne capture (« pousser transcript_path » n'est
>      pas un motif textuel).

### Convention : les `raison` de D7 ne couvrent pas tout, les fiches complètent

Les champs `raison` de `d7.json` ne disent pas toujours pourquoi un fichier
hors-propos figure dans `coteMoteur` — l'explication vit dans un commentaire
de code (`d7-boundary.mjs:95-98` pour `decodage-jsonl`, `:60-64` pour
`resolution-du-dossier-de-configuration`), invisible à qui lit `d7.json`
seul. Deux exemples réels : `netgain/src/mcp/main.ts` figure dans
`coteMoteur` du geste `decodage-jsonl` sans aucun rapport avec
`core/jsonl.ts` — il décode du JSON-RPC, pas des transcripts, et n'y figure
que parce que le motif de détection l'atteint aussi par coïncidence
syntaxique (expliqué dans la fiche C2) ; `netgain/src/cli.ts` figure dans
`coteMoteur` du geste `resolution-du-dossier-de-configuration` sans jamais
lire `process.env` — il ne fait qu'annoncer la variable dans son texte
d'aide (expliqué dans la fiche C5). **Convention retenue pour ce rapport :**
quand un `coteServeur` ou `coteMoteur` contient une entrée que sa `raison` ne
motive pas explicitement, la fiche correspondante porte l'explication en
prose plutôt que de laisser le lecteur la reconstruire seul.

### Limites propres à cet audit, non écrites ailleurs

- **Le contrôle de vérité terrain (`verite-terrain.test.mjs`) n'exerce que
  D3 et D7** — les trois premiers contrôles interrogent `d3.json`, le
  quatrième `d7.json`. **D1, D2, D4, D5 et D6 n'ont aucun contrôle de bout en
  bout** : une régression dans cinq détecteurs sur sept, qui produirait
  toujours un JSON syntaxiquement valide, passerait inaperçue.
- **`--comparer` prouve qu'un rejeu retrouve la base committée, pas que
  cette base soit juste.** L'égalité bit à bit entre deux exécutions garantit
  la reproductibilité de l'instrument, jamais l'exactitude de ce qu'il
  affirme.
- **`stdio: 'ignore'` sur la régénération de couverture** (l'appel à
  `node --test --experimental-test-coverage` dans `run.mjs`) : une panne
  réelle de cette étape ne laisse qu'un code de sortie non nul, sans aucun
  message de diagnostic à lire.
- **`couverture.lcov` change d'environ 1272 lignes à chaque régénération**,
  par simple réordonnancement des blocs `SF:` selon la façon dont
  `node --test` distribue ses fichiers de test en parallèle — alors que
  `docs/audit/resultats/d6.json` reste stable au bit près d'une régénération
  à l'autre (voir défaut n°7 ci-dessous : c'est exactement ce que le
  correctif par union des lignes `DA:` garantit). Bruit attendu de l'outil de
  test sous-jacent, pas un signal d'instabilité de D6.
- **Les deux ambiguïtés résiduelles de l'heuristique regex/division**
  (le cas de `}`, et une division qui suit immédiatement une regex sans
  drapeau) sont nommées en tête de `lib/tokens.mjs` — voir la citation
  complète ci-dessus — et vérifiées absentes de ce dépôt à ce commit.
- **`claude-sonnet-5` est absent de tous les candidats de `d2.json`** — voir
  la limite n°2 de `d2-truth-sources.mjs` citée ci-dessus, et le défaut n°6
  de la liste qui suit. Une omission ne laisse par définition aucune trace
  dans le résultat ; elle n'est donc nommée qu'ici, dans cette annexe et dans
  l'en-tête du détecteur — nulle part dans `d2.json` lui-même.
- **Les chiffres de périmètre de l'en-tête diffèrent de ceux annoncés par le
  plan** (17 445 lignes mesurées contre 17 332 estimées ; 108 873 jetons
  mesurés contre 109 762 estimés ; 113 fichiers dans les deux cas). Le plan
  doc/34 a été rédigé avant l'écriture de `source-files.mjs` et `tokens.mjs` ;
  ses chiffres de lignes et de jetons sont des estimations de rédaction, pas
  une mesure par cet outillage — seul le compte de fichiers, plus facile à
  établir à la main, tombe juste dès le départ. Une partie de l'écart sur les
  jetons s'explique en plus par un correctif de fond fait pendant cet audit
  (tâche 5) : une expression rationnelle littérale émet désormais **un seul
  jeton** au lieu de plusieurs fragments — ce qui réduit le compte total,
  dans le même sens que l'écart observé entre le mesuré et l'estimé.

### Sept défauts d'instrument trouvés et refermés pendant l'audit

Chacun trouvé en FAISANT TOURNER le détecteur sur le vrai dépôt, aucun par
seule lecture de son code — la preuve la plus solide que ces instruments ont
été étalonnés, pas crus sur parole. Trois faux positifs (le détecteur
affirme ce qui n'existe pas), trois omissions silencieuses (le détecteur
tait ce qui existe — **les plus dangereuses : une entrée manquante ressemble
en tout point à une absence de défaut**), un non-déterminisme.

1. **[faux positif] D3, `formatage-monetaire`.** Le motif attrapait toute
   ouverture d'interpolation de gabarit (`` `${ ``). Aurait fait dire au
   rapport : « 44 fichiers / 247 sites formatent la monnaie à la main » —
   une duplication massive et fausse — contre 6 fichiers / 22 sites réels.
   Refermé par une lookahead négative sur les deux alternatives concernées.
2. **[faux positif] D4, le graphe d'imports.** Le motif ne distinguait pas
   le code d'un commentaire : un exemple d'API en JSDoc dans
   `lib/install-hooks.js` a fabriqué une boucle du fichier sur lui-même.
   Aurait fait dire : « 2 dépendances circulaires » — dont une entièrement
   fictive — contre 1 cycle réel. Refermé en neutralisant les commentaires
   avant le balayage (chaînes reconnues en premier, pour qu'un `//` littéral
   dans une URL survive).
3. **[faux positif, resté dormant] D4, le neutraliseur lui-même.** Le
   correctif de l'item précédent utilisait une classe de caractères
   (`["'\s]`) à l'intérieur d'une expression rationnelle littérale ; son
   guillemet a désynchronisé la reconnaissance de chaînes et laissé 33
   lignes de commentaires non blanchies dans 2 fichiers. Aurait pu faire
   apparaître une arête fantôme si l'un de ces commentaires avait contenu
   `require(...)` ou `import … from` — vérifié ligne à ligne : aucun ne le
   fait, donc aucun chiffre n'a changé, mais l'exposition était réelle.
   Refermé avec la même expression rationnelle littérale que celle
   introduite au socle (item suivant).
4. **[omission silencieuse] `lib/tokens.mjs`, le socle de D1 et D5.** Une
   expression rationnelle littérale n'était pas reconnue comme un jeton
   unique ; un guillemet ou une accolade internes pouvaient désynchroniser
   le comptage d'accolades dont D5 dépend pour délimiter les fonctions.
   Aurait fait dire : « `detector.ts` ne contient aucune fonction » (1
   masquée), « `hasImportShape` s'étend sur 30 lignes » (4 réelles, un
   facteur 7,5) — avec 2 fichiers de plus touchés en silence total,
   invisibles même à la sonde de contrôle qui avait d'abord servi à mesurer
   les 3 premiers cas. Refermé en apprenant au tokenizer à reconnaître une
   expression rationnelle littérale comme un seul jeton ; D1 inchangé au bit
   près, D5 corrigé sur 5 fichiers.
5. **[omission silencieuse] D2, la table scindée.** L'extracteur ne lit
   qu'un littéral d'objet à la fois ; le second littéral du moteur
   (`MODEL_INFO`, qui ne porte que `maxInput`) tombe sous le seuil de deux
   champs reconnus et est écarté. Aurait fait dire : « 10 modèles `claude-*`
   ont des tarifs divergents entre serveur et moteur » — une fausse alerte
   sérieuse — alors que les 4 taux ET `maxInput` s'accordent sur les 10.
   Refermé par une limite documentée en tête de `d2-truth-sources.mjs`,
   corroborée par le test de miroir tarifaire (2/2 pass).
6. **[omission silencieuse] D2, `claude-sonnet-5`.** Le motif interne
   (`[^{}]{0,400}`) interdit toute accolade ; `claude-sonnet-5` est la seule
   entrée de `FALLBACK` à porter un champ `history` imbriqué, donc invisible
   côté serveur. Aurait fait dire : rien du tout — ce modèle n'apparaît dans
   AUCUNE liste de `d2.json`, ni comme sain ni comme divergent, simplement
   absent, indiscernable d'une entrée qui n'existerait pas. Refermé par une
   limite documentée en tête de `d2-truth-sources.mjs`.
7. **[non-déterminisme] D6, `couverture.lcov`.** `parseLcov` ne gardait que
   le DERNIER bloc `SF:` par chemin ; l'ordre des blocs dépend de
   l'ordonnancement parallèle de `node --test`, donc change d'un lancement à
   l'autre. Aurait fait dire : « `viz-watchdog-client.js` est parmi les
   fichiers les moins testés du dépôt » — un chiffre entre 138 et 209 lignes
   sur 230 selon le run — alors que l'union réelle vaut 230/230, couverture
   totale. Refermé par une union des lignes `DA:` (commutative, associative
   par construction) ; déterminisme prouvé par double exécution complète.

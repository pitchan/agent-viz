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
lignes et 109 762 jetons. Les deux écarts sont eux-mêmes mesurés, pas de
simples estimations de rédaction : une convention de comptage de lignes pour
le premier, un correctif de fond de cet audit pour le second. Le détail est
dans l'annexe méthode.
**Exclus :** `netgain/dist/` (généré), `node_modules/`, `tests/fixtures/`,
`docs/` (l'audit ne s'audite pas lui-même)
**Rejouable :** `node --test "docs/audit/scripts/**/*.test.mjs"` puis
`node docs/audit/scripts/run-all.mjs --comparer`
**Qualification préparée par :** Claude
**Relue et acceptée par :** Vincent — 2026-08-10 — commit `aba0953`

## Verdict d'une page

Huit constats, classés par rang puis par confiance décroissante. Les huit
portent une confiance « démontré » (aucun n'est resté au stade « probable »
ou « hypothèse ») ; à confiance égale, l'ordre suit le numéro de constat.

| # | Constat | Rang | Confiance | Coût | Fenêtre |
|---|---|---|---|---|---|
| C1 | Perte de capture totale et silencieuse sur un crochet préfixé d'un BOM | P0 | démontré | S | à traiter séparément |
| C2 | Décodage JSONL réimplémenté sur 7 fichiers serveur, tolérance BOM incidente et inégale | P1 | démontré | L | à absorber par la fusion |
| C4 | Contrat de tarification divergent : pilote temps réel muet, Observatoire honnête | P1 | démontré | M | à absorber par la fusion |
| C5 | Deux variables d'environnement pour un seul dossier de configuration | P1 | démontré | S | à absorber par la fusion |
| C3 | Accumulation des jetons d'usage dupliquée entre serveur et moteur | P2 | démontré | M | à absorber par la fusion |
| C6 | Trois clients HTTP côté navigateur | P2 | démontré | S | transportable tel quel |
| C7 | Le rapport cite un document de calibration qui n'existe pas dans ce dépôt | P2 | démontré | S | à absorber par la fusion |
| C8 | Trois formateurs de durée, réimplémentés à l'identique | P2 | démontré | S | transportable tel quel |

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
**divergence**. C3, C6, C7 et C8 partagent un impact « coût de maintenance
seul », qui n'entre dans la définition ni de P0 ni de P1 et place
directement en P2 — deux d'entre eux (C6, C8) trouvés dans le code, un
(C7) trouvé dans le rapport lui-même, en vérifiant sa propre citation.
Aucun constat ne descend en P3 — et **ce n'est pas parce qu'ils portent tous
un coût chiffré (S/M/L)** : le gabarit de fiche impose cette colonne à
chacun, l'argument serait circulaire et ne discriminerait rien. La raison est
que chacun nomme une conséquence observable aujourd'hui, là où P3 suppose
« sans risque immédiat ». Pour les quatre constats à impact « coût de
maintenance seul » — les seuls candidats plausibles à P3 — cette conséquence
est écrite dans leur fiche : **C3**, deux accumulations d'usage à faire
évoluer en parallèle, dont une seule ventile le cache par fenêtre ;
**C6**, un correctif de robustesse (délai d'attente, nouvelle tentative,
message d'erreur homogène) n'atteindrait qu'un tiers du code ; **C7**, trois
fichiers LIVRÉS envoient leur lecteur vers un chemin qui n'a jamais existé
dans ce dépôt ; **C8**, trois copies des deux mêmes seuils (1000 ms,
60 000 ms), qu'aucun mécanisme ne tient synchronisées. Mais la
fenêtre n'est plus uniforme : C1 est urgent et sans rapport avec la fusion
(« à traiter séparément ») ; C6 et C8 vivent entièrement côté `public/`, la
fusion ne les touche pas (« transportable tel quel ») ; C2, C3, C4, C5 et
C7 attendent réellement la réunion des deux arbres (« à absorber par la
fusion »). C'est la fenêtre, pas le rang, qui distingue ici QUAND agir, pas
SI agir.

## Constats

Huit constats sont retenus, chacun rejouable depuis les résultats de
`docs/audit/resultats/*.json` (régénérables par
`node docs/audit/scripts/run-all.mjs`) ou depuis une lecture directe des
fichiers cités. Plusieurs candidats mesurés par les détecteurs ne figurent
volontairement pas ci-dessous, pour deux raisons distinctes — à ne pas
confondre. **Certains sont des artefacts de l'instrument** : le détecteur
affirme ou tait quelque chose de faux (le faux positif monétaire de D3,
l'omission `claude-sonnet-5` de D2…) ; l'annexe méthode (tâche 11) et le
rapport de tâche en détaillent la liste, sept au total. **D'autres sont des
candidats réels, mesurés sans erreur d'outillage, mais jugés trop minces ou
trop cohérents pour justifier une fiche séparée** : sept des douze familles
de D3 (`formatage-octets`, `formatage-date`, `resolution-de-chemin-maison`,
`formatage-numerique-en-dur`, `declaration-de-formateur`,
`formatage-pourcentage`, `formatage-a-locale-implicite`) restent dispersées
sur des sites isolés, un ou deux par fichier, sans implémentation concentrée
à consolider — contrairement à `formatage-duree`,
qui EN portait une (trois fonctions quasi identiques) et a reçu sa propre
fiche, C8. Les cinq candidats `chemin-litteral` de D2
(`.claude`, `projects`, `.agent-viz`, `.claude.json`, `subagents`) sont tous
à `valeursDistinctes: 1` : des segments de chemin répétés, mais qui
s'accordent partout, sans divergence à trancher — le même genre de
consistance que les dix `tarif-de-modele` et les dix `code-d-evenement`
couverts plus bas dans « Ce qui est sain », pas un défaut cousin de C5.

> **CORRIGÉ AU TRAITEMENT DE C5 (2026-08-11) : `.claude.json` ÉTAIT un défaut
> cousin de C5, et le paragraphe ci-dessus se trompe à son sujet.**
> `valeursDistinctes: 1` mesure que le *littéral* est identique partout — il ne
> dit rien de la façon dont le chemin est CONSTRUIT autour. Les trois sites
> écrivaient bien `'.claude.json'`, mais deux d'entre eux le joignaient au home
> en ignorant `CLAUDE_CONFIG_DIR`, alors que Claude Code déplace ce fichier avec
> la variable (vérifié en exécutant la version 2.1.226 sur les deux branches).
> **Une valeur unique n'est donc pas une preuve d'accord** : c'est la limite de
> ce détecteur, et elle vaut pour les quatre autres candidats de la liste. Un
> site a été corrigé (`observatory/index.js:34`), un autre escaladé
> (`netgain/src/install/paths.ts:37`) — détail dans la fiche C5.

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
| intégrité de ce qui est conservé | démontré | S | à traiter séparément | à corriger |

**Sur la fenêtre : ce constat n'attend pas la fusion.** Le correctif tient en
deux lignes de `lib/hook.js` (retirer le BOM avant `JSON.parse`, écrire dans
`_hook-errors.log` même quand l'analyse échoue) et ne touche à rien côté
`netgain/src/` — rien dans le déplacement des deux arbres ne le facilite ni
ne le complique. Le classer « à absorber par la fusion » comme les cinq
autres constats aurait fait attendre un P0 de perte de données silencieuse
pour une raison de calendrier sans rapport avec lui. **C1 se corrige
maintenant, avant tout le reste** — y compris avant les tests de
caractérisation ci-dessous, qui préparent C2 à C4 mais n'ont aucune raison de
retarder C1.

---

Les trois constats suivants (C2 à C4) portent sur les trois gestes que la
tâche 7 a mesurés comme dupliqués entre `lib/` et `netgain/src/` avec une
cible déjà arbitrée par Vincent. Leur ordre de traitement, à respecter dans
doc/36, est fixé une fois ici — **après C1, qui n'attend personne** :
**tests de caractérisation là où ils manquent d'abord**, puis décodeur JSONL
commun, puis primitive d'accumulation d'usage, puis contrat de tarification
structuré et affichage honnête.

**Correction, portée après signature — la version initiale de ce passage
justifiait « tests de caractérisation d'abord » par une inférence que
`d6.json` INTERDIT explicitement.** Elle citait le tableau `limites` (« le
moteur n'a pas de couverture d'exécution : atteignabilité statique
seulement ») pour en conclure que les fichiers de `netgain/src/` visés par
C2 à C4 n'avaient aucune preuve d'exécution — alors que la limite suivante,
dans le même tableau, énonce : « **Un fichier "sans preuve d'exécution"
n'est PAS un fichier non testé.** » Cette phrase existe précisément pour
interdire cette lecture. Vérification : `netgain/` porte **37 fichiers de
test** exécutés par `npm run test:engine` (458 contrôles), dont
`tests/core/jsonl.test.ts`, `tests/doctor/tokens.test.ts` et
`tests/core/pricing.test.ts` — c'est-à-dire les **trois cibles exactes** de
C2, C3 et C4. D6 ne les voyait pas parce que son instrument mesure la
couverture de `node --test`, qui n'exécute pas la suite `vitest` du moteur :
c'est une limite du PÉRIMÈTRE DE MESURE, jamais un fait sur le code.

**Ce que la mesure dit vraiment, une fois les deux côtés regardés.** Côté
serveur, où D6 mesure réellement, les cibles sont majoritairement bien
couvertes : `lib/server/tokens.js` **95,6 %** (C3),
`lib/server/pricing.js` **85,7 %** (C4), et pour les sept fichiers de C2,
`transcript-adapters/claude.js`, `watchdog/catch-up.js` et
`watchdog/journal.js` à **100 %**, `event-reader.js` **81,1 %**,
`transcript.js` **75,2 %**. **Deux trous réels, et deux seulement :
`lib/server/housekeep.js` à 20,5 % (31/151) et
`lib/server/session-index.js` à 55,8 % (72/129)**, tous deux dans le
périmètre de C2. Le filet à écrire avant de toucher au décodage JSONL est
donc étroit et nommable — ces deux fichiers — et non une campagne de
caractérisation sur tout le moteur. `lib/hook.js` était le seul fichier
vraiment sans aucune preuve d'exécution parmi les cibles ; C1 l'a doté de
ses trois premiers tests.

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
jamais énoncé nulle part comme une politique commune). `lib/server/transcript.js:198-200`
porte en plus un `leftover` pour suivre un fichier qui grossit (lecture
incrémentale d'un flux en direct) : ce geste est réellement spécialisé et ne
doit pas être replié dans la primitive commune.

**Cible.** Une seule primitive de décodage de ligne (BOM retiré, ligne vide
sautée, ligne cassée signalée plutôt qu'avalée), réutilisée par les
différents modes de lecture. Le suivi incrémental de `lib/server/transcript.js:198`
reste spécialisé et n'y est pas replié.

| Impact | Confiance | Coût | Fenêtre | Traitement |
|---|---|---|---|---|
| intégrité de ce qui est conservé | démontré | L | à absorber par la fusion | à corriger |

> **PRÉCISÉ APRÈS TRAITEMENT (2026-08-11) — la tolérance n'est pas « au BOM »,
> elle est à TOUT LE BLANC D'UNICODE.** La cible de cette fiche dit « BOM
> retiré » ; la primitive livrée fait `line.trim()`, qui retire toute la
> production *WhiteSpace* + *LineTerminator* d'ECMAScript. Mesuré, chaque forme
> refusée par `JSON.parse` seul et acceptée par la primitive : U+FEFF, U+00A0
> (insécable), U+2009 (fine), U+2028 (séparateur de ligne), U+3000 (cadratin).
> **Contrôle négatif qui borne la propriété : U+200B** (espace de largeur nulle)
> n'appartient pas à *WhiteSpace* et reste **refusé** — la tolérance est
> exactement celle d'ECMAScript, pas « tout ce qui est invisible ».
>
> **Arbitrage de Vincent (2026-08-11) : assumée et écrite, pas restreinte.** La
> restreindre au seul BOM demanderait d'écrire à la main un sous-ensemble de ce
> que `trim()` fait déjà — du code en plus, pour rendre le lecteur *moins*
> tolérant sur des fichiers écrits par un tiers. Rejeter une ligne qu'on savait
> lire est la perte silencieuse que C1 a coûtée. L'en-tête de
> `netgain/src/core/jsonl.ts` porte désormais la propriété telle qu'elle est.
>
> **PIÈGE DE CONTRAT DÉCOUVERT AU TRAITEMENT DE C5 (2026-08-11).** `{ ok: true }`
> promet un JSON valide, **pas un objet** : une ligne valant `null` rend
> `{ ok:true, value:null }`, et `42` ou `"texte"` de même. Sur les 7 sites qui
> décodent puis déréférencent, **deux levaient** — établi par exécution, pas par
> lecture : `watchdog/journal.js` (`rec.kind`, hors du `try`) et
> `watchdog/catch-up.js` (`processEvent` lit `evt._ts`). Les cinq autres
> survivaient, chacun pour une raison différente (pré-garde `"usage"`, garde
> `evt &&`, déréférencement dans un `try`). Corrigés le 2026-08-11 : voir la
> fiche de traitement de C5 pour ce que ça coûtait réellement.
>
> **OBSERVATION LAISSÉE OUVERTE, ET DATÉE COMME TELLE (2026-08-11) —
> `readAndBroadcast` n'a pas de `leftover` là où `readTailDelta` en a un.** Il lit
> `[offset, newStat.size)` puis pousse le curseur à `newStat.size` ; si cette
> borne tombait en milieu de ligne, le fragment serait rejeté et jamais relu —
> une perte d'événement sur le chemin vif, indépendante de C2.
> **PISTE NON REPRODUITE, PAS UN CONSTAT** : elle dépend de l'atomicité de
> l'ajout d'une ligne par l'écrivain, qui n'a jamais été prouvée. Elle n'a été ni
> instrumentée ni reproduite ici, et c'est délibéré : instrumenter une écriture
> concurrente est un chantier à part entière, pas un à-côté de C5. Elle reste
> ouverte, avec ce statut exact.

### C3 — L'accumulation des jetons d'usage est réimplémentée côté serveur et côté moteur

**Fait brut.** `docs/audit/resultats/d7.json`, geste `agregation-de-jetons`,
`verdict: "duplique"` : `lib/server/tokens.js:50-85` (`accumulateUsage`) et
`netgain/src/doctor/aggregators/tokens.ts:20-27` (`addUsage`, appelée depuis
`TokensAggregator.addAssistant`, lignes 79-104). Rejouable par
`node docs/audit/scripts/run-all.mjs`.

`coteServeur` déclare en plus `provenance.js` et `pricing.js`, `coteMoteur`
`core/events.ts`, `core/pricing.ts`, `context.ts` et `turns.ts` (motif du
détecteur : `cache_creation_input_tokens` — voir la section « Convention : les
`raison` de D7 ne couvrent pas tout, les fiches complètent » en annexe).
Aucun des six ne réimplémente `accumulateUsage`/`addUsage` : `provenance.js:21`
ne fait que NOMMER le champ dans un texte d'aide destiné à l'utilisateur ;
`core/events.ts:6` ne fait que le TYPER, dans l'interface `RawUsage` (lignes
3-12), sans lire ni écrire aucun champ — un transtypage le fait transiter tel
quel (`normalizeAssistant`, ligne 99) ; `pricing.js` et `core/pricing.ts`
lisent le même champ brut pour CALCULER un coût, pas pour l'accumuler — c'est
le geste `tarification`, couvert par C4 ; `context.ts:229` l'utilise pour le
suivi du churn de cache (une troisième fin, hors périmètre de cette fiche) ;
`turns.ts:47` en fait la somme par tour de conversation, une quatrième
consommation indépendante du même champ. Six fichiers atteints par la
coïncidence du motif de détection, aucun n'étant une septième implémentation
du geste que cette fiche compare.

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

> **TRAITÉ LE 2026-08-11 — et cette fiche se trompait sur un point, dans le sens
> rassurant.** Elle affirme « les mêmes gardes à zéro » et « il n'y a pas de
> divergence de comportement sur ce périmètre commun ». Une **sonde
> différentielle** — la même matrice de 13 cas poussée dans les deux fonctions
> réelles, pas deux lectures comparées — en trouve **deux**, de la même famille
> qu'en C5 : une question de garde, invisible à l'œil.
>
> | cas | serveur (`\|\| 0`, `if (msgId)`) | moteur (`?? 0`, `!== null`) |
> |---|---|---|
> | `input_tokens: NaN` | 0 | **NaN** — empoisonne le seau pour toute la session |
> | même `id: ""` deux fois | accumule 2× | **déduplique** |
>
> **ET AUCUNE DES DEUX N'EST ATTEIGNABLE**, vérifié — parce qu'un écart dans une
> primitive ne prouve pas qu'on puisse y arriver. `JSON.parse` **refuse** le
> littéral `NaN` ; `"id":""` apparaît **0 fois sur les 833 transcripts** de la
> machine. Ce sont des pièges **latents**, gratuits à supprimer en unifiant. Ils
> ne sont pas racontés comme des pannes.
>
> **La garde retenue : un champ qui n'est pas un nombre FINI vaut zéro.** Aucune
> des deux d'avant ne couvrait tout — `|| 0` laissait passer `Infinity`, `?? 0`
> laissait passer les deux, et **les deux** transformaient un nombre en chaîne en
> `"0100"` par concaténation, faisant partir le seau entier en texte jusque dans
> l'enveloppe SSE. `Infinity` est le seul de ces poisons qu'un JSON **valide**
> puisse porter : `1e999` s'analyse en `Infinity`.
>
> **L'identifiant vide : c'est le sens du serveur qui gagne.** Dédupliquer sur
> `''` fusionnerait des messages **distincts** dépourvus d'identifiant en un
> seul, donc **sous-compterait** — le sens le plus difficile à voir. Même
> doctrine que la variable d'environnement vide de C5.
>
> **`tokenSum` et `netTokens` n'ont pas été fusionnées** : l'arbitrage de la
> fiche est respecté. Le « dernier message », le modèle courant et le coût à
> l'analyse restent côté serveur — ce sont des préoccupations du pilote temps
> réel, pas de l'accumulation.
>
> **LE GESTE EXISTE AUSSI DANS `public/`, ET CETTE FICHE NE LE DIT PAS.**
> `public/viz-state.js:185` (`tokenTotal`) est **interchangeable avec `tokenSum`
> du serveur sur toute la matrice** — 9 cas, 0 écart, y compris `NaN`, chaînes et
> négatifs (prouvé en exécutant les deux fonctions, pas en les lisant). Et
> `public/viz-ui.js:157-161` accumule les quatre champs en ligne, l'équivalent du
> `sumInto` du moteur. **Hors périmètre de C3 par arbitrage de Vincent
> (2026-08-11)** : le navigateur ne peut pas charger `netgain/dist`, donc
> l'unifier demanderait d'exposer un module ES par HTTP — un mécanisme neuf, pas
> un déplacement de code. Cette trouvaille rejoint C6 et C8, qui traitent déjà la
> duplication dans `public/`.
>
> Commits `03ffce3`, `6d36c72`.

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
  ligne 44-46 dit, en anglais dans le texte : *« the real-time pill can adopt
  the same table (unification) »*. L'unification qu'il évoque porte sur la
  TABLE de prix, pas sur le CONTRAT de résultat pour un modèle inconnu — et
  cette unification-là de la table est déjà faite : `lib/server/pricing.js:333-336`
  documente `applyEnginePrices`, appelée au démarrage par `lib/server.js:97`,
  qui remplace le mirroir `FALLBACK` par la table embarquée du moteur. Le
  pilote temps réel lit donc aujourd'hui la même table que l'Observatoire ;
  ce n'est pas ce qui diverge. Ce qui diverge, et persiste malgré cette table
  commune, c'est la forme du résultat quand un modèle n'y figure pas — le
  sujet réel de ce constat.
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

> **TRAITÉ LE 2026-08-11 — le constat tient, mais la fiche se contredisait, et
> la divergence qu'elle avait manquée court dans l'autre sens.**
>
> **La sonde différentielle d'abord, la fiche ensuite** — quatrième fois que ce
> geste paie. Même matrice (24 identifiants de modèle × 13 formes d'usage)
> poussée dans les deux implémentations réelles : **18 écarts**.
>
> **1. La trace citée par cette fiche est du CODE MORT.** Le premier point
> ci-dessus dit que `lib/server/pricing.js` « rend `0` pour un modèle inconnu et
> journalise un avertissement » ; le quatrième dit que `tokens.js` encadre tout
> par `if (price)` et que « rien n'est mis à jour ». **Les deux ne peuvent pas
> décrire le même appel — et c'est le quatrième qui a raison.** Le seul appelant
> de production passait un **objet prix**, et la branche fautive était gardée par
> `typeof modelOrPrice === 'string'` : elle n'était jamais atteinte. Prouvé trois
> fois — par `grep` (un seul appelant), par exécution (`traces = []` sur une
> session entière à modèle inconnu), et par **mutation** (un `throw` dans la
> branche faisait tomber **2 tests sur 788**, tous deux des appels directs ;
> aucun test serveur, aucun test d'intégration). En production le message
> n'était pas « tarifé à zéro » : il était **entièrement ignoré**, sans trace.
> `ZERO_COST` du serveur était mort pour la même raison.
>
> **2. Le montant n'était pas faux — il était une borne inférieure muette.**
> Mesuré au niveau produit sur une même session : Observatoire **$0,2500
> (partiel ⚠)**, pastille **$0,2500** sans réserve. Les montants sont
> **identiques** ; ce qui manquait était la réserve. Et **66,7 % du coût réel de
> la session était absent des deux vues** — le moteur le disait, la pastille non.
>
> **3. La normalisation divergeait, dans le sens INVERSE de la thèse de la
> fiche.** `normalizeId` du serveur était un **sur-ensemble strict** de
> `normalizeModel` du moteur : routeurs régionaux (`us.`/`eu.`/`global.`/`au.`),
> préfixes empilés (`bedrock/anthropic.…`), suffixe `-vN` seul. Sur
> `us.anthropic.claude-opus-4-7` le **moteur** annonçait « partiel » pendant que
> le **serveur** tarifait correctement. **0 occurrence sur 834 transcriptions**
> de la machine de mesure → latent ici, réel pour un déploiement Bedrock/Vertex.
> Traité dans C4 par arbitrage de Vincent : sans ça, le symptôme même que C4
> ferme serait resté atteignable par une autre entrée.
>
> **4. `<synthetic>` est le cas qui interdisait la correction naïve.** 80
> occurrences sur 834 transcriptions, entrelacées dans des sessions normales. Le
> serveur ne savait pas distinguer un **0 $ assumé** d'un **tarif inconnu** :
> marquer l'incomplétude sur un simple test de nullité du tarif aurait signalé
> « partiel » sur des sessions parfaitement justes. C'est ce qui impose de passer
> par `pricingKindOf` du moteur — `tarife` / `zero-voulu` / `inconnu` — et non
> par un montant nul, qu'un modèle tarifé sans jetons produit aussi.
>
> **5. Deux écarts LATENTS de plus, corrigés parce que l'unification les rendait
> atteignables.** `cache_creation: null` — du JSON valide — faisait **lever** le
> `computeCost` du moteur et pas celui du serveur (0 occurrence sur 834) ;
> `normalizeEvent` passe `usage` par `asRec` mais ne touche pas à ses champs. Le
> serveur déléguant désormais sa formule au moteur, sans durcissement
> l'unification aurait **fait apparaître** côté serveur une panne qu'il n'avait
> pas. Idem `__proto__`, qui rendait `NaN` côté serveur.
>
> **Ce qui a changé.** Une seule normalisation et une seule formule, en
> TypeScript ; **quatrième pont**, `lib/server/pricing-engine.js`, comme prévu —
> et il n'ajoute aucun mode de panne : `netgain/dist` écarté, **le serveur
> refuse déjà de démarrer depuis C2** (vérifié en exécutant, `jsonl.js` lève en
> premier). Le seau porte `costComplete` et `unknownModels` jusqu'à l'enveloppe
> SSE, additive. Le commentaire de `FALLBACK` affirmait qu'il couvrait « le
> moteur absent » : **c'était faux**, corrigé — il ne couvre que la fenêtre
> d'amorçage.
>
> **À l'écran (arbitrages de Vincent, 2026-08-11).** Coût partiel avec une part
> connue → « **au moins $4.17** », l'énoncé exact du sens de l'erreur ;
> infobulle « **coût PARTIEL** », le mot que la page Observatoire emploie déjà à
> six endroits, avec les modèles nommés. Aucun modèle tarifé → « **coût
> indisponible** » (« au moins $0 » est vrai et ne prétend rien), et **la
> pastille s'affiche désormais** au lieu de disparaître : le modèle et le volume
> de jetons sont connus, seule la fenêtre manque. Vérifié dans le vrai DOM sur
> une instance de contrôle, cinq états, y compris la remontée depuis un
> sous-agent et un **témoin** d'enveloppe antérieure à C4 (qui reste « complet »,
> `undefined` n'étant pas `false`).
>
> **Filets.** Moteur 493 → **502**, serveur 788 → **801**. Les deux mutations de
> contrôle discriminent : complétude toujours vraie → **3 rouges** ; retour au
> silence d'avant C4 → **9 rouges**. Trois filets de caractérisation sont passés
> au rouge et ont été **mis à jour, datés** — jamais contournés ; un quatrième
> (« computeCost accepts a resolved price object ») a été supprimé, en disant
> pourquoi : cette double signature était l'optimisation qui **fabriquait** le
> constat.
>
> **Reste ouvert, non traité :** `netgain/src/install/paths.ts` (préséance
> `CLAUDE_CONFIG_DIR` / `NETGAIN_HOME`, escaladé depuis C5) et l'absence de
> `leftover` dans `readAndBroadcast` (piste non reproduite, cf. C5).
>
> Commits `65883c1`, `ddc7089`, `6798bb9`.

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

> **TRAITÉ LE 2026-08-11 — et la fiche sous-estimait le constat sur deux points,
> tous deux trouvés en exécutant, aucun visible à la lecture.**
>
> **Le constat lui-même, prouvé avant d'écrire une ligne.** Les quatre
> croisements, le home neutralisé pour rendre le repli visible :
>
> | variable posée | moteur (`netgain doctor --list`) | serveur (`observatory/index.js`) |
> |---|---|---|
> | `NETGAIN_CLAUDE_DIR` | suit → 1 session | ignore → `~/.claude` |
> | `CLAUDE_CONFIG_DIR` | ignore → 0 session | suit → dossier posé |
>
> `netgain/src/cli.ts:24` a bien été vérifié avant d'y toucher : texte d'aide
> seul, aucune résolution — la fiche avait raison.
>
> **Variable retenue : `CLAUDE_CONFIG_DIR`, et l'argument n'est pas l'usage.**
> C'est le nom que **Claude Code définit lui-même** — 31 occurrences dans le
> binaire 2.1.226 installé, **0 pour `NETGAIN_CLAUDE_DIR`** (témoin négatif). Le
> moteur observe ce produit ; il en adopte le vocabulaire au lieu d'en inventer
> un second. L'ancienne variable est **supprimée**, pas repliée (arbitrage de
> Vincent) : elle n'était annoncée qu'au `netgain --help`, et `netgain/README.md`
> n'est même pas dans le champ `files` du paquet.
>
> **PREMIER POINT MANQUANT — la divergence n'était pas seulement dans le nom.**
> Le moteur employait `??` (nullish) là où le serveur employait `||` (falsy).
> Avec la variable **posée mais vide**, le moteur scannait la chaîne vide et
> annonçait « 0 session(s) découverte(s) sous  » : une cécité totale et
> silencieuse, qu'un utilisateur lit comme « je n'ai pas de sessions ». Deux
> expressions jumelles mais séparées avaient donc **déjà divergé une fois** sans
> que personne ne le voie. C'est ce que le partage rend impossible, au-delà des
> noms. Sens retenu des deux côtés : une variable vide EST une variable non
> posée.
>
> **SECOND POINT MANQUANT — `.claude.json` suit la même variable, autrement.**
> `lib/server/observatory/index.js:34` cherchait ce fichier au home **dans tous
> les cas**. Établi en exécutant Claude Code 2.1.226 dans un home entièrement
> jetable, les deux branches :
>
> | `CLAUDE_CONFIG_DIR` | où Claude Code écrit `.claude.json` |
> |---|---|
> | posée | `$CLAUDE_CONFIG_DIR/.claude.json` |
> | non posée | `~/.claude.json` — **pas** `~/.claude/.claude.json` |
>
> Recoupé sur la machine réelle. D'où une fonction séparée dans la primitive : le
> raccourci évident `join(resolveClaudeDir(), '.claude.json')` se trompe dans le
> cas par défaut. Conséquence concrète : ce défaut est ce qui faisait disparaître
> la carte R2 du protocole de contrôle de l'instrument (USERPROFILE jetable +
> `CLAUDE_CONFIG_DIR` réel) — un coût noté « assumé » dans la recette, alors
> qu'il était ce défaut-ci. **Cela invalide au passage la ligne de « Constats »
> qui range `.claude.json` parmi les cinq `chemin-litteral` de D2 « qui
> s'accordent partout, sans divergence à trancher, pas un défaut cousin de C5 » :
> c'en était un.**
>
> **ESCALADÉ, NON TRAITÉ — `netgain/src/install/paths.ts:37`.** Il résout
> `~/.claude.json` en ignorant la variable lui aussi, et il **écrit** au lieu de
> lire. Il arbitre déjà entre `NETGAIN_HOME` — une couture de test — et le home :
> faire primer `CLAUDE_CONFIG_DIR` là-bas est une question de **préséance entre
> deux variables**, donc un arbitrage qui appartient à Vincent, pas un geste
> mécanique. L'élargir seul aurait changé la sémantique de `netgain on/off` sans
> validation.
>
> Commits `1941fcc`, `3ac3a2a`, `ead8063`.

### C6 — Trois clients HTTP côté navigateur

**Fait brut.** `docs/audit/resultats/d3.json`, primitive `appel-http-client` :
`public/observatory/api.js`, `public/viz-network.js` et
`public/viz-watchdog-client.js` en zone web (3 des 7 fichiers distincts
recensés par la primitive, les 4 autres étant des appels HTTP côté serveur
Node, un geste différent). `docs/audit/resultats/d4.json`, tableau
`importsDIO`, confirme que ce sont exactement les 3 entrées de zone `web`
(`modules: ["(fetch global)"]`). Rejouable par
`node docs/audit/scripts/run-all.mjs`.

**Raisonnement.** `public/observatory/api.js:5-24` définit déjà `getJson` et
`postJson`, avec une gestion d'erreur qui transforme un statut HTTP non-OK en
`Error` lisible — mais **les deux fonctions ne sont pas exportées** (`async
function getJson(url)`, `async function postJson(url, body)`, sans `export` ;
seuls les appelants de haut niveau du fichier, `fetchSummary`,
`fetchSessions`… le sont). `api.js` ne les « expose » qu'à lui-même
aujourd'hui. `public/viz-network.js` (lignes 187, 200, 227, 329) appelle
`fetch(...)` directement à quatre endroits, sans passer par `api.js` ni
refaire de gestion d'erreur homogène. `public/viz-watchdog-client.js:49`
déclare son propre alias `_fetch` — un point d'injection pour les tests, pas
un traitement d'erreur partagé. Trois chemins pour un même geste, sans raison
qui les distingue : une correction de robustesse (ajout d'un timeout, d'une
nouvelle tentative, d'un message d'erreur uniforme) n'atteindrait qu'un tiers
du code si elle n'est faite que dans un des trois fichiers.

**Cible.** Un seul client HTTP, importé par les trois fichiers — ce qui
suppose d'abord d'EXPORTER `getJson`/`postJson` (ou une factory équivalente)
depuis `api.js`, pas seulement de les réutiliser tels quels.

| Impact | Confiance | Coût | Fenêtre | Traitement |
|---|---|---|---|---|
| coût de maintenance seul | démontré | S | transportable tel quel | à corriger |

**Sur la fenêtre :** les trois fichiers sont tous en zone `web`, aucun ne
touche `netgain/src/` — le déplacement de `netgain/src/` dans l'arbre
d'`agent-viz` ne rend ce constat ni plus facile ni plus difficile à corriger.
Contrairement à C2 à C5, rien ici n'attend que les deux arbres soient
réunis.

### C7 — Le rapport cite un document de calibration qui n'existe pas dans ce dépôt

**Fait brut.** Trois fichiers LIVRÉS pointent vers le même chemin mort :
`lib/server/observatory/rules/thresholds.js:6` (« report
(netgain/docs/calibration-observatoire-m1.md, dated 2026-07-27: 1695
sessions, 14 projects) »), `tests/unit/observatory-rule-r1.test.js:6` (même
chemin, même date), `tests/unit/observatory-rules-cost.test.js:63` (même
chemin). Vérifié : `netgain/docs/` n'existe pas (`ls netgain/docs` échoue),
`git ls-files | grep -i calibration` est vide, et aucun commit de
l'historique du dépôt ne l'a jamais touché
(`git log --all --full-history -- "*calibration*"` est vide). Rejouable par
ces trois commandes.

**Raisonnement.** Les chiffres eux-mêmes sont réels, pas inventés : ils
vivent dans le commentaire de `thresholds.js:6-22`, qui les recopie et
ajoute le raisonnement complet — pourquoi R1 est passé de 0,05 à 0,20 (9
projets sur 14 déclenchés à 0,05, contre le critère de sortie « jamais plus
de la moitié »), et pourquoi 0,20 précisément (7 sur 14, tout en couvrant
89 % des jetons de changement de préfixe). Le document externe que les trois
fichiers citent, lui, n'a jamais fait partie de ce dépôt : ni du commit
audité, ni d'aucun commit avant ou après. Trois lecteurs différents — qui
maintient les seuils, et les auteurs des deux fichiers de test qui les
épinglent — suivraient la même citation vers un chemin introuvable, sans
autre repli que relire le commentaire qui la contient déjà. C'est une dette
de traçabilité, pas un défaut de calcul : la mesure derrière `calibration`
est correcte et documentée, seule son adresse est fausse.

**Cible.** Faire converger la citation et la réalité : soit importer
l'enregistrement de calibration dans ce dépôt (sous `docs/`, à l'endroit que
la fusion choisira pour la documentation transversale), soit corriger les
trois citations pour pointer vers `thresholds.js:6-22`, qui porte déjà tout
ce qu'un lecteur peut vérifier.

| Impact | Confiance | Coût | Fenêtre | Traitement |
|---|---|---|---|---|
| coût de maintenance seul | démontré | S | à absorber par la fusion | à corriger |

Une symétrie mérite une phrase : cet audit a trouvé ce défaut en vérifiant
sa propre citation — exactement la discipline qu'il revendique par ailleurs
(on calibre, on ne fait pas confiance).

### C8 — Trois formateurs de durée, réimplémentés à l'identique

**Fait brut.** `docs/audit/resultats/d3.json`, primitive `formatage-duree` :
10 fichiers / 30 sites au total (la primitive détecte toute comparaison ou
division liée à une durée en millisecondes, un filet plus large que le seul
geste de formatage — elle attrape aussi des seuils de règles, `thresholds.js`,
`r6-short-subagents.js`). En son sein, trois fichiers portent la MÊME
fonction, presque au caractère près : `public/viz-layout.js:341-346`
(`calcDuration`, exportée), `public/viz-narrator.js:188-194`
(`formatSessionDuration`, privée au module), `public/viz-ui.js:403-411`
(`updateLiveDurations`, la même logique compressée en un ternaire imbriqué à
la ligne 410, sans nom propre). Rejouable par
`node docs/audit/scripts/run-all.mjs` pour la localisation, puis par lecture
directe des trois fichiers pour le mécanisme.

**Raisonnement.** Les trois partagent les deux mêmes seuils (1000 ms,
60 000 ms) et le même gabarit de sortie :

```
if (ms < 1000) return `${ms}ms`;
if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
return `${(ms / 60000).toFixed(1)}m`;
```

`viz-layout.js` et `viz-narrator.js` ne diffèrent que par leurs gardes
d'entrée (nom des paramètres, valeur de repli sur une entrée invalide —
`null` contre `'?'`) ; `viz-ui.js` porte la même arithmétique, réécrite en
une expression, sans jamais appeler l'une des deux fonctions déjà exportées
ou déclarées ailleurs dans le même dossier `public/`. C'est une famille plus
large que celle des trois clients HTTP de C6 (`appel-http-client` : 7
fichiers / 12 sites au total, 3 promus) : ici, 10 fichiers / 30 sites, et
une triplication littérale démontrée sur trois d'entre eux, jamais
consolidée. Vérité terrain établie avant le premier run d'aucun détecteur
(tâche 0 du plan) : `viz-layout.js`, `viz-narrator.js` et `viz-ui.js`
contiennent chacun un motif de formatage de durée — ce même fait, mesuré à
la main, tient toujours après lecture du code.

**Cible.** Une seule fonction de formatage de durée, exportée depuis un
module partagé de `public/`, importée par les trois fichiers — le même
geste de consolidation que C6, sur une famille plus large.

| Impact | Confiance | Coût | Fenêtre | Traitement |
|---|---|---|---|---|
| coût de maintenance seul | démontré | S | transportable tel quel | à corriger |

Comme C6, les trois fichiers sont tous en zone `web` ; rien n'attend la
fusion avec `netgain/src/`.

## Ce qui est sain

Un rapport qui ne liste que des défauts ment par omission (doc/34), et des
développeurs le sentent. Huit réponses « c'est sain » suivent. Deux se
rejouent par une commande (`node --test`, sortie citée) ; les six autres
citent le fichier exact ou le résultat JSON qui porte la preuve — aucune
n'avance sans source vérifiable.

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
vérifié à la main puis confirmé par le test ci-dessus. **Le test ci-dessus
va plus loin que les dix modèles vus par D2** : sa première assertion boucle
sur `Object.keys(_FALLBACK).length === table.entries.length`, soit les
**onze** entrées de la table (`claude-sonnet-5` inclus), et sa seconde
exerce `claude-sonnet-5` nommément. Le modèle qu'un motif interne de D2 ne
peut pas voir (limite n°2 ci-dessous, l'imbrication de `history`) est donc
bel et bien couvert — par ce test, indépendamment de D2 — et cette omission
précise n'a aucune conséquence pratique. La cause est un
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

`calibration` renvoie au commentaire d'en-tête de ce même fichier
(`lib/server/observatory/rules/thresholds.js:6-22`), qui enregistre la
distribution observée sur 90 jours (1695 sessions, 14 projets, mesure du
2026-07-27) et la raison de chaque valeur retenue — il note même l'écart
avec la première proposition du plan pour R1 (0,05 → 0,20, pour ne jamais
dépasser la moitié des projets déclenchés). Ce commentaire cite lui-même un
document séparé, `netgain/docs/calibration-observatoire-m1.md` — **un
chemin qui n'existe pas dans ce dépôt** (constat C7 ci-dessus) ; les
chiffres qui comptent pour un lecteur de cette table sont ceux que le
commentaire porte directement, pas ce chemin mort. `spec` renvoie à doc/12
§7 : la changer, c'est changer la spécification. Zéro candidat
`seuil-de-regle` n'est ressorti de D2 — cohérent avec des seuils déjà
centralisés en un seul fichier plutôt que recopiés ailleurs.

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
6 à 17 lignes chacune — trop minces à côté des huit constats retenus (le
terrain inter-zone, à bien plus fort enjeu, est déjà couvert par C2 à C5,
issus de D7) pour justifier une fiche séparée.

### Open/Closed : dix codes d'événement répétés, zéro aiguillage à rouvrir

Les dix candidats `code-d-evenement` de D2 (`session`, `agent`, `assistant`,
`stuck`, `user`, `alert`, `status`, `badInvocation`, `skill`, `mcp` —
`valeursDistinctes: 1` partout) auraient pu annoncer un répartiteur central
fragile, qu'ajouter un type d'événement forcerait à rouvrir. Lecture
directe : `public/viz-canvas.js`, `viz-layout.js`, `viz-narrator.js` et
`viz-ui.js` branchent chacun sur le même `n.type`, et pour CET axe-là, aucun
répartiteur central unique n'existe — quatre fichiers indépendants, chacun
avec sa propre responsabilité déjà établie (dessin du nœud, mise en page,
texte de narration, comptage pour l'UI). Ajouter un type oblige à toucher
les quatre, mais chaque édition est justifiée par la responsabilité propre
du fichier, jamais par la réouverture d'un aiguillage partagé. La
duplication littérale reste réelle comme défaut DRY (dix chaînes recopiées
sans constante partagée) mais n'est pas un défaut d'architecture.

**Il faut nommer une chose que l'énoncé ci-dessus, pris seul, pourrait
laisser croire absente du dépôt : un répartiteur central existe bel et bien,
juste sur un AUTRE axe.** `public/viz-layout.js:313-323` définit
`EVENT_HANDLERS`, une table qui associe chaque `evt.hook_event_name`
(`SessionStart`, `SubagentStart`, `PostToolUse`…) à sa fonction de
traitement, dispatchée en une ligne à `:333`
(`const handler = EVENT_HANDLERS[evt.hook_event_name]; if (handler)
handler(evt, sid, ts);`). Le commentaire qui la précède, ligne 162-163, dit
ce que c'est : *« Adding a new hook event = one entry in EVENT_HANDLERS »*.
C'est exactement la réponse Open/Closed que la spec demande, et de la bonne
espèce : étendre par une entrée de données, pas par une branche de code. Les
deux constats ne se contredisent pas — `n.type` (dessin/mise en page/texte)
et `evt.hook_event_name` (dispatch d'événement de crochet) sont deux axes
distincts, et le second, qui vit dans le même fichier que l'un des quatre
brancheurs du premier, a déjà son registre central, ouvert à l'extension.

### Interface Segregation : `SessionReport` ne fait subir sa largeur à personne

`netgain/src/doctor/report/types.ts:11-38` : 20 champs (19 obligatoires plus
1 optionnel, `skipped?`), composés de types nommés et étroits par
sous-domaine (`ContextStats`, `PromptsStats`, `ReadStats`, `SessionKind`,
`SubagentStats`, `TokensResult`, `ToolResultStats`, `TurnsStats`), chacun
défini et consommé indépendamment par son propre agrégateur. **Les deux
fichiers d'abord cités comme consommateurs du type complet ne le sont pas** :
`report/json.ts` tient en 15 lignes, `stableStringify(value: unknown)`, sans
aucun import de type — sérialisation générique, indifférente à la forme du
rapport ; `report/terminal.ts` importe `DoctorReport` (ligne 15,
`renderReport(r: DoctorReport)` ligne 286), jamais `SessionReport`. Les
vrais consommateurs sont `scan-session.ts:20`
(`export async function scanSession(...): Promise<SessionReport>`, le
producteur) et `doctor/index.ts:28,85-86` (`totalsOf`, qui lit **5 des 8**
sous-domaines typés — `tokens`, `toolResults`, `subagents`, `prompts`,
`turns` ; jamais `context`, `reads` ni `sessionKind` comme champ de
`SessionReport` qu'elle lit — `context` et `SessionKind` reviennent ailleurs
dans le fichier, sans rapport avec `totalsOf` (`findClaudeMdFiles` importé de
`context.js` ligne 5, `NoMarkerDetail` et `SessionKind` réexportés en type
lignes 153-154) ; `reads` n'y figure sous aucune forme — vérifié par grep sur
les 156 lignes du fichier). La conclusion ISP tient sur cette base-là : aucun
consommateur étroit ne subit la largeur
d'un type dont il n'utiliserait qu'une fraction — `totalsOf` en utilise une
majorité mais jamais la totalité, et rien dans le dépôt ne consomme les 8
sous-domaines d'un coup en dehors du producteur lui-même. Les rendus qui ont
légitimement besoin de la totalité du rapport travaillent sur `DoctorReport`
(l'agrégat), pas sur `SessionReport` (l'unité) — un niveau plus haut que ce
que la fiche affirmait à l'origine.

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
régénère puis compare au résultat déjà committé, champs volatils exclus de
la comparaison — les quatre clés de `CLES_VOLATILES`
(`write-result.mjs:35` : `commitOutils`, `genereLe`, `node`, `nonSuivis`) —
et sort en code 1 au premier écart — **elle régénère et laisse donc l'arbre
de travail sale** ; restaurer `docs/audit/resultats/` avant de committer
quoi que ce soit d'autre.

*Note du rapport : le champ `nonSuivis` d'un résultat donné (par exemple
`d1.json`, qui porte aujourd'hui `M docs/audit/resultats/couverture.lcov` et
`?? docs/audit/scripts/run-all.mjs` en plus de `?? tests/CLAUDE.md`) peut
donc contenir plus que la seule exception nommée en en-tête de ce document.
Ce n'est pas une contradiction : l'en-tête décrit l'état À L'OUVERTURE de
l'audit (avant la tâche 0), alors que `nonSuivis` est un instantané de
`git status --porcelain` pris au moment où CE résultat précis a été
régénéré — en cours de branche, avec les artefacts de travail encore non
committés de ce moment-là (l'outillage de l'audit lui-même, avant son propre
commit ; une couverture fraîchement recalculée). C'est précisément pour
cette raison que `nonSuivis` fait partie de `CLES_VOLATILES` et sort de la
comparaison de rejouabilité.*

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

**Note du rapport :** le chiffre de 103 192 fenêtres, recopié ci-dessus
depuis l'en-tête d'origine de `d1-clones.mjs` (non modifié — code plan-
mandaté, verbatim), est une mesure PRÉ-correctif de la tâche 5 : avant que
`lib/tokens.mjs` n'apprenne à reconnaître une expression rationnelle
littérale comme un seul jeton, le même texte tokenisait en davantage de
jetons, donc davantage de fenêtres. Mesuré directement sur le dépôt à ce
commit, avec le tokenizer corrigé : **102 303 fenêtres**. L'espérance de
collision recalculée à cette valeur reste **≈ 1,2** (1,218 précisément) —
l'argument que ce paragraphe défend n'en est pas affecté, seul le chiffre
d'entrée a changé.

### Limites de `docs/audit/resultats/d6.json` (bloc `limites`, verbatim)

> - Un chargement dynamique (import() calculé, VM, processus enfant) échappe aux deux mesures.
> - Le moteur n’a pas de couverture d’exécution : atteignabilité statique seulement.
> - Un fichier « sans preuve d’exécution » n’est PAS un fichier non testé.

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
>      fausse regex qui avale `2; const s = 10 ` en entier, la même famille
>      de panne que celle que cette heuristique existe pour éliminer,
>      atteinte par une autre route. Corollaire vérifié : une regex AVEC
>      drapeau est saine, car la lettre du drapeau se lit comme un
>      pseudo-identifiant et disqualifie le `/` suivant :
>      `const r = /re/g / 2; const s = 10 / 5;` tokenise correctement en
>      `["const","r","=","/re/g","/","NUM",";","const","s","=","NUM","/","NUM",";"]`.
>      VÉRIFIÉ ABSENT de ce dépôt à ce commit (642 portées D5 stables,
>      `d1.json` identique au jeton près, 0 fichier déséquilibré sur 113
>      après le correctif de cette même tâche) : c'est une limite NOMMÉE, pas
>      un défaut vivant. Non corrigée — chaque changement du socle coûte un
>      nouveau cycle D1/D5 et une revue, pour un cas absent de ce corpus.
>      Arbitrage du contrôleur (2026-08-10).

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

*Exception déclarée à la règle « verbatim » : le fragment cité juste en
dessous, ``['"`]\s*\$``, contient un guillemet oblique en son sein (le
caractère qui, dans cette classe de caractères regex, détecte un guillemet
oblique littéral). Le commentaire source l'encadre d'un seul niveau de
guillemets obliques ; recopié tel quel, ce guillemet interne casserait le
rendu Markdown en fermant la portée de code trop tôt. Le texte est identique
au caractère près à celui du fichier source ; seul le délimiteur Markdown
qui l'entoure a été élargi à deux guillemets obliques.*

> LIMITE ASSUMÉE : ces motifs sont syntaxiques. Un formatage écrit autrement
> (Intl, bibliothèque tierce) passerait au travers — aucun n'existe dans ce
> dépôt au commit audité, et c'est précisément ce que dit le constat sur les
> conventions numériques.

*Note du rapport : ce fragment, cité verbatim ci-dessus, renvoie en avant à
« le constat sur les conventions numériques » — un constat que ce rapport ne
contient pas. La passe de qualification (tâches 10-11) a examiné les
familles numériques de D3 (`formatage-octets`, `formatage-numerique-en-dur`,
`formatage-pourcentage`, `formatage-a-locale-implicite`, entre autres — voir
la section « Constats » ci-dessus) et les a jugées trop dispersées, sur des
sites isolés sans implémentation concentrée, pour justifier une fiche
propre — la même conclusion que pour les trois autres familles de formatage
non retenues (`formatage-date`, `resolution-de-chemin-maison`,
`declaration-de-formateur`). Le renvoi que fait ce commentaire pointait donc vers une
intention de rédaction du détecteur, jamais matérialisée en constat final ;
il n'a plus de cible dans ce document.*

> LIMITE CORRIGÉE À L'EXÉCUTION (2026-08-10) : le motif formatage-monetaire
> attrapait à l'origine toute interpolation de gabarit — sa branche
> guillemet-puis-`$` (``['"`]\s*\$``) matchait aussi bien un backtick suivi de
> `${` que le `$` d'un vrai montant. Le premier run réel a montré 225 sites
> sur 247 relevant de cette confusion. Une lookahead négative `(?!\{)` a été
> ajoutée aux deux alternatives où le `$` peut être un sigil d'interpolation
> (la 2ᵉ et la 4ᵉ) ; la 1ʳᵉ et la 3ᵉ, où le `$` précède le guillemet ou suit
> `USD`, n'avaient pas ce problème et sont inchangées. LIMITE RESTANTE,
> vérifiée : un `$` nu suivant un guillemet est toujours pris pour une devise
> qu'il en soit une ou non (ex. un séparateur de fin de motif quelconque) ;
> et un formatage monétaire écrit sans `$` ni `USD` reste invisible à cette
> famille.

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
> Ce qui reste NON couvert par ce correctif, faute d'usage constaté pour le
> justifier : `usesFetch`, plus bas, teste le texte BRUT, pas neutralisé — un
> `fetch(` écrit dans un commentaire fabriquerait un import d'I/O fantôme
> exactement sur le même principe. Mesuré sur ce dépôt à ce commit : aucun
> cas (`fetch(` n'apparaît jamais UNIQUEMENT dans un commentaire) — c'est
> donc une zone aveugle non déclenchée, pas un défaut corrigé. Par ailleurs
> la première alternative de SPEC (`import|export ... from ...`) utilise
> `[^'"()]*?` qui franchit toujours les retours à la ligne : une construction
> inhabituelle en code réel (pas en commentaire) pourrait en principe encore
> faire pont entre deux instructions distinctes.
>
> Ce qui reste : l'heuristique regex-vs-division reprend celle de
> `lib/tokens.mjs` telle quelle, y compris son ambiguïté résiduelle assumée
> sur `}` (un `/` après `}` est traité comme une regex par défaut — voir la
> « DÉCISION ÉCRITE » de `lib/tokens.mjs` pour le détail et sa justification,
> non répétée ici). Un risque distinct, plus grave, a aussi été soulevé par
> relecture : un `/*` littéral À L'INTÉRIEUR d'une classe de caractères d'une
> regex (ex. `/[/*]/`) pourrait, si l'heuristique classe par erreur cette
> position comme une division, être lu par l'alternative de commentaire de
> BLOC comme une ouverture réelle — celui-là BLANCHIRAIT du code réel et
> pourrait donc faire perdre une arête, contrairement au guillemet non
> apparié qui n'en fait jamais perdre. VÉRIFIÉ ABSENT de ce dépôt (recherché
> sur les 113 fichiers : aucune classe de caractères de regex ne contient de
> séquence `/*` littérale) — risque nommé, non rencontré, non couvert par un
> contrôle automatisé.
>
> Autre limite constatée : un spécificateur relatif qui vise un fichier réel
> mais d'une extension hors périmètre (`.js`/`.mjs`/`.ts` seulement — voir
> lib/source-files.mjs) ne résout jamais et finit dans `nonResolus` sans être
> une faute de frappe. Constaté sur `lib/server/observatory/engine.js` →
> `../../../package.json`.

*Note du rapport : le passage cité ci-dessus renvoie à une section
« DÉCISION ÉCRITE » de `lib/tokens.mjs`. Ce nom ne correspond plus à rien
dans le fichier actuel (`grep -n "DÉCISION" docs/audit/scripts/lib/tokens.mjs`
ne renvoie rien) — le contenu visé existe toujours, sous le titre
`HEURISTIQUE (division vs regex…)`, réécrit lors de la correction de la
tâche 5. Le renvoi n'est pas cassé sur le fond (le lecteur retrouve
l'explication), seulement sur le nom qu'il cherche.*

**`d5-volumetry.mjs`** :

> LA MÉTRIQUE PORTE SON PÉRIMÈTRE DANS SON NOM : `fonctionsMotCleFunction`.
> Elle ne compte QUE les déclarations par le mot-clé `function`, imbriquées
> comprises. Les fonctions fléchées et les méthodes de classe ou d'objet en
> sont absentes. La v1 appelait ça « fonctions » tout court, ce qui laissait
> croire à une couverture qu'elle n'avait pas.
>
> Ce qui RESTE vrai après le correctif : D5 hérite de toute limite résiduelle
> de `lib/tokens.mjs` (voir son en-tête pour le détail, non dupliqué ici) —
> l'ambiguïté de `}` non résolue par construction, le mot-clé contextuel `of`
> délibérément non couvert, ET une division qui suit immédiatement une regex
> SANS DRAPEAU (trouvé par la revue, 2026-08-10 — mécanisme, reproduction et
> vérification d'absence dans l'en-tête de `lib/tokens.mjs`). Aucun de ces
> cas n'a été mesuré dans ce dépôt à ce commit.

**`d7-boundary.mjs`** :

> LIMITES DE CE DÉTECTEUR, écrites au moment où elles sont acceptées
> (tâche 7) :
>   1. `verifyMatrix` ne regarde que les zones `server` et `engine` (voir le
>      filtre dans la boucle `sitesInattendus` ci-dessous). Un site qui
>      correspond au motif dans la zone `web` est invisible par
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
de code (`d7-boundary.mjs:95-98` pour `decodage-jsonl`, `:60-63` pour
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
  `node --test --experimental-test-coverage` dans `run-all.mjs:38`, pas dans
  `run.mjs` — `run.mjs` ne contient aucun `execFileSync`) : une panne
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
  plan (17 445 lignes mesurées contre 17 332 ; 108 873 jetons mesurés contre
  109 762 ; 113 fichiers dans les deux cas), et ce ne sont PAS des
  estimations de rédaction — les deux écarts se vérifient exactement, pour
  deux raisons différentes, ni l'une ni l'autre une marge d'erreur.**
  **Lignes :** `wc -l` sur les 113 fichiers du périmètre donne **17 332**,
  le chiffre du plan à l'unité près — mesuré directement, pas estimé. L'écart
  avec les 17 445 publiées vient d'une convention de comptage, la même que la
  tâche 5 avait déjà mise au jour sur un seul fichier
  (`lib/install-hooks.js`, 744 contre 743) : `text.split('\n').length`,
  utilisé par `source-files.mjs`, compte une ligne fantôme de plus que
  `wc -l` pour chaque fichier qui se termine par un saut de ligne — et les
  113 fichiers du périmètre s'y terminent tous. 17 445 − 17 332 = **113**,
  exactement un fantôme par fichier, vérifié par un décompte indépendant des
  deux conventions sur les mêmes 113 fichiers.
  **Jetons :** l'écart, 109 762 − 108 873 = **889**, n'est pas une marge
  d'estimation non plus. Le nombre de fenêtres de 60 jetons que produit ce
  même périmètre est passé de 103 192 (chiffre pré-correctif, cité en tête de
  `d1-clones.mjs`) à **102 303** mesuré aujourd'hui — une baisse de,
  exactement, **889** également. Ces deux écarts indépendants, calculés par
  deux détecteurs différents sur la même correction de fond, tombent
  EXACTEMENT sur la même valeur : la preuve que 109 762 n'était pas un
  chiffre de rédaction mais une mesure réelle **PRÉ-correctif**, par ce même
  tokenizer, avant que la tâche 5 n'apprenne à `lib/tokens.mjs` à émettre un
  seul jeton pour une expression rationnelle littérale plutôt que plusieurs
  fragments. L'écart de jetons n'est donc pas partiellement expliqué par ce
  correctif : il l'est ENTIÈREMENT, à l'unité près.

### Sept défauts d'instrument trouvés pendant l'audit : cinq corrigés, deux explicitement bornés

Chacun trouvé en FAISANT TOURNER le détecteur sur le vrai dépôt, aucun par
seule lecture de son code — la preuve la plus solide que ces instruments ont
été étalonnés, pas crus sur parole. Trois faux positifs (le détecteur
affirme ce qui n'existe pas), trois omissions silencieuses (le détecteur
tait ce qui existe — **les plus dangereuses : une entrée manquante ressemble
en tout point à une absence de défaut**), un non-déterminisme.

**Distinction à ne pas lisser : cinq de ces sept ont été CORRIGÉS dans
l'instrument** (items 1 à 4 et 7 — le détecteur ne produit plus le résultat
fautif) **et deux ont seulement été BORNÉS** (items 5 et 6, tous deux dans
D2 — le détecteur souffre toujours de la limite, qui est nommée en tête de
`d2-truth-sources.mjs` et dont la conséquence a été vérifiée par un autre
moyen). Un défaut borné reste un défaut : `d2.json` ne verra pas plus une
table de tarifs scindée en deux littéraux demain qu'aujourd'hui.

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
   **BORNÉ, NON CORRIGÉ** : l'extracteur ne sait toujours pas lire une table
   scindée. La limite est documentée en tête de `d2-truth-sources.mjs`, et la
   conclusion (« le miroir tarifaire est sain ») est établie par un autre
   moyen — le test de miroir tarifaire, 2/2 pass — pas par le détecteur.
6. **[omission silencieuse] D2, `claude-sonnet-5`.** Le motif interne
   (`[^{}]{0,400}`) interdit toute accolade ; `claude-sonnet-5` est la seule
   entrée de `FALLBACK` à porter un champ `history` imbriqué, donc invisible
   côté serveur. Aurait fait dire : rien du tout — ce modèle n'apparaît dans
   AUCUNE liste de `d2.json`, ni comme sain ni comme divergent, simplement
   absent, indiscernable d'une entrée qui n'existerait pas. **BORNÉ, NON
   CORRIGÉ** : le motif interdit toujours les accolades, donc toute entrée
   de `FALLBACK` portant un champ imbriqué restera invisible. La limite est
   documentée en tête de `d2-truth-sources.mjs`.
7. **[non-déterminisme] D6, `couverture.lcov`.** `parseLcov` ne gardait que
   le DERNIER bloc `SF:` par chemin ; l'ordre des blocs dépend de
   l'ordonnancement parallèle de `node --test`, donc change d'un lancement à
   l'autre. Aurait fait dire : « `viz-watchdog-client.js` est parmi les
   fichiers les moins testés du dépôt » — un chiffre entre 138 et 209 lignes
   sur 230 selon le run — alors que l'union réelle vaut 230/230, couverture
   totale. Refermé par une union des lignes `DA:` (commutative, associative
   par construction) ; déterminisme prouvé par double exécution complète.

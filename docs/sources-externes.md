# Sources externes — les documents que ce code cite et qui ne vivent pas ici

**Pourquoi ce fichier.** Constat **C7** de `docs/audit-qualite-code.md` : trois fichiers
citaient un relevé de calibration par un chemin relatif, `netgain/docs/calibration-observatoire-m1.md`,
qui n'a jamais existé dans ce dépôt — ni au commit audité, ni à aucun commit avant ou après.
Un lecteur suivait l'adresse et ne trouvait rien.

Le document, lui, existe : il vit dans le **dépôt privé de pilotage de la thèse**, avec neuf
autres que ce code cite aussi. Ces documents **restent privés** — ce n'est pas un oubli mais
une décision du **2026-08-06**, prise quand le moteur `netgain` a déménagé de ce dépôt privé
vers celui-ci : le code est venu, les relevés et les plans sont restés. Ils portent des noms de
projets réels, des volumes de jetons et des coûts en dollars qui sont la matière de la
soutenance.

Ce fichier est donc l'**adresse** de ces dix documents. Il ne recopie aucun de leurs contenus :
pour chacun, la dernière colonne dit ce qui, **dans ce dépôt**, porte déjà la substance qu'un
lecteur peut vérifier.

## La convention, en deux règles

1. **Un chemin relatif vers un `.md`, écrit dans un commentaire, est une adresse de CE dépôt.**
   Il doit résoudre. `tests/repo/documentation-citations.test.mjs` le vérifie à chaque
   `npm test` : une citation morte fait rougir la suite, en nommant le fichier et la ligne.
2. **Un document qui vit ailleurs se cite par son identifiant court**, jamais par un chemin :
   `doc/NN` pour le dépôt privé, le nom du plan pour les archives du moteur. Le tableau
   ci-dessous les traduit tous. C'était déjà la forme majoritaire dans le code (41 des 51
   citations, mesurées le 2026-08-11) : la règle nomme l'usage établi, elle ne l'invente pas.

## Les dix documents

`doc/NN` désigne le document numéro NN du dépôt privé ; les trois derniers vivaient dans
`netgain/docs/` tant que le moteur y était hébergé, et sont aujourd'hui sous
`doc/netgain-archives/plans/` du même dépôt privé.

| Cité comme | Document, et sa date | Ce que le code lui doit | Ce qui en tient lieu **ici** |
|---|---|---|---|
| `doc/10` | Design de l'outil `netgain` — approuvé le 2026-07-09, révisé v2 le même jour | Le test contrôlé « condition C » sur la recherche d'outils : les définitions découvertes sont **ajoutées** à l'historique, le préfixe n'est pas touché, le cache tient (+265 jetons, relecture complète du cache) | `lib/server/observatory/rules/r1-prefix-change.js:36-45` — le mécanisme, sa réfutation et la conséquence (`toolsAppeared: null`) sont écrits sur place |
| `doc/12` | Design « Observatoire » (M1) — spec validée le 2026-07-27 | §7 : les seuils de R2 (50 % / 10 %), R5 (≥ 2) et R6 (5 min, 30 %). Les changer, c'est changer la spec | `lib/server/observatory/rules/thresholds.js` — chaque seuil déclare son origine (`'spec'` ou `'calibration'`) ; `tests/unit/observatory-rules-cost.test.js` épingle les valeurs |
| `doc/27` | Calibration du détecteur d'erreurs d'invocation — relevé du 2026-08-08 : 370 sessions, 8 projets, 24 182 appels d'outil, 587 échecs réels | Les 37 expressions de la table de motifs, et pour chacune ses occurrences **et** ses faux positifs | `tests/unit/invocation-patterns.test.mjs` § 8 — les 37 expressions y sont recopiées une fois, extraites de son bloc `FAILURE_PATTERNS` ; ce fichier tient le rôle de témoin |
| `doc/30` | Un motif qui mélangeait deux causes — arbitrage utilisateur du 2026-08-08, sur relevé | La scission de `inv-bash-unbalanced-quote` en deux motifs, chacun nommant sa cause | `tests/unit/invocation-patterns.test.mjs` § 8, bloc du **second** relevé — tenu séparé du premier, pour ne pas mentir sur la provenance |
| `doc/32` | Refonte de la page Conseils — validé le 2026-08-09, amendé le même jour | L'accordéon par cause, la commande consignée, les remèdes : la forme de la page et ce qu'elle promet | `public/observatory/` (`advisor-view.js`, `failures-view.js`, `failures-format.js`, `remedies.js`) et leurs tests |
| `doc/34` | Design de l'audit de qualité de code — 2026-08-10 | Les rangs P0–P3, le budget de faux positifs assumé, la règle « un détecteur se contrôle avant d'être cru » | `docs/audit-qualite-code.md` (verdict, annexe méthode) et `docs/audit/scripts/` |
| `doc/35` | Plan de l'audit, en 11 tâches — 2026-08-10 | La convention de comptage des lignes et des jetons du périmètre audité | `docs/audit/scripts/lib/tokens.mjs`, `docs/audit/scripts/lib/source-files.mjs` |
| `calibration-observatoire-m1` | Calibration des seuils de l'Observatoire — relevé du 2026-07-27 : 1 695 sessions, 14 projets, 90 jours | Les cinq seuils marqués `'calibration'`, la distribution observée pour chacun, et la raison en une phrase de la valeur retenue | `lib/server/observatory/rules/thresholds.js:4-22` — la distribution et le raisonnement y sont recopiés, y compris le relèvement de R1 de 0,05 à 0,20 ; les cinq valeurs sont épinglées par `tests/unit/observatory-rules-cost.test.js` |
| `plan J7` | Plan « J7 » étape 1 — ventilation causale de la re-création de cache | L'écart mesuré réponse-à-réponse, et l'approximation assumée qui en découle | `netgain/src/doctor/aggregators/context.ts` — la classification et son approximation sont commentées sur place |
| `plan J8` | Plan « J8 » étape 1 — chiffrer le gisement des relectures `Read` | Les cinq cas de lecture (`firstRead`, `identicalReread`, `modifiedReread`, `crossAgentDuplicate`, `error`) | `netgain/src/doctor/aggregators/reads.ts:6-11` — les cinq cas sont listés et définis dans l'en-tête |

## Ce qu'un lecteur sans accès au dépôt privé peut faire

**Tout vérifier de ce qui l'engage, sauf la mesure elle-même.** Les seuils, les motifs, les cas
et les définitions vivent dans le code de ce dépôt et sont épinglés par des tests ; ce que les
documents privés ajoutent, c'est **la distribution observée** qui a fait choisir ces
valeurs-là. Un chiffre qu'on ne peut pas rejouer sans les 90 jours d'historique d'une machine
donnée n'aurait de toute façon pas été rejouable en publiant le document.

## Deux limites, nommées plutôt que tues

- **Le paquet npm ne contient pas `docs/`.** `package.json` (`files`) n'embarque que `bin/`,
  `lib/`, `public/`, `netgain/dist/` et deux fichiers racine — choix antérieur à ce fichier,
  et inchangé. Un lecteur qui n'a que le paquet installé a le commentaire, qui porte la
  substance ; l'adresse, elle, vit dans le dépôt. Le filet de `tests/repo/` mesure les
  citations **contre le dépôt**, et c'est ce qu'il annonce.
- **Ce fichier ne surveille pas la forme courte.** `doc/NN` ne prétend pas être un chemin :
  aucun test ne peut vérifier qu'un numéro existe dans un dépôt qui n'est pas là. Si un numéro
  disparaît du dépôt privé, ce tableau vieillit sans bruit. Il est daté pour cette raison.

*Tableau établi le 2026-08-11, au traitement de C7 — 51 citations relevées dans 27 fichiers.*

# Architecture d'agent-viz

**Ce que ce document dit :** de quoi le produit est fait, qui a le droit
d'appeler qui, et par où passent les données.

**Ce qu'il ne dit pas :** comment s'en servir — c'est [README.md](./README.md) ;
ce qui va mal dedans — c'est [docs/audit-qualite-code.md](./docs/audit-qualite-code.md).

---

## 0. La règle qui a écrit ce document

Un document d'architecture meurt de deux façons. Il décrit des **chemins**, et
le premier déplacement de fichier l'invalide en entier. Ou il aligne des
**décomptes**, et le commit suivant les périme sans que personne ne s'en
aperçoive.

Les deux se soignent par la même discipline :

> Une affirmation de structure est une **règle falsifiable, accompagnée de la
> commande qui la vérifie** — pas une impression, et de préférence pas un
> décompte. « Le navigateur ne charge aucun module de `src/server/`, et voici le
> test qui rougit sinon » vaut mieux que « `src/web/` contient 28 fichiers ».

Les décomptes qui subsistent portent la commande qui les refait, écrite à côté
d'eux, et jamais la date ou le commit du relevé. S'ils ont vieilli, la commande
le dira ; c'est tout ce qu'on leur demande. Ce document décrit l'état présent :
ce qui a changé, et quand, se lit dans les messages de commit.

Deux détails de méthode, parce qu'ils ont mordu pendant la rédaction. Les
fichiers se comptent avec `find`, **pas** avec `git ls-files "a/**/*.x"` — cette
seconde forme a sous-compté d'un fichier sur l'arbre de tests du moteur,
silencieusement. Et sous Git Bash, **aucun argument ne commence par `/`** : MSYS
le réécrit en chemin Windows avant que le programme ne le voie, une alternation
`grep -E "/(a|b)/"` est détruite, et la sortie vide se lit comme une preuve —
même famille que le tube littéral du § 3.

---

## 1. Un produit, un paquet, trois unités

agent-viz est **un seul paquet npm**, `@vcueto/agent-viz`, publié depuis un seul
dépôt. Le moteur d'analyse — *netgain* — n'est pas une dépendance : c'est une
partie du produit, dont la source vit dans `src/engine/` et dont le build part
dans le même tarball. Un utilisateur qui a le produit a le moteur ; il n'y a rien
à brancher à côté.

Sous ce paquet unique vivent **trois unités**, qui n'ont pas la même raison de
changer, pas le même langage, et pas la même bibliothèque disponible :

| Unité | Ce dont elle est seule responsable | Ce qu'elle ne fait jamais |
|---|---|---|
| **serveur** | capter les hooks, tenir le démon, servir HTTP et SSE, orchestrer les scans, tenir la base dérivée | lire un transcript ligne à ligne, calculer un prix, dessiner |
| **moteur** | lire les transcripts, découvrir les sessions, agréger les jetons, tarifer, appliquer les règles de diagnostic | connaître le démon, connaître une page, ouvrir un socket HTTP entrant |
| **navigateur** | rendre, tenir l'état de page, réagir | toucher au disque, ouvrir un fichier, importer un module `node:` |

Cette table est l'**invariant**. Les répertoires qui la portent aujourd'hui sont
au § 8 — c'est la seule chose qui change de **sens** quand l'arbre bouge. Les
chemins **cités** ailleurs dans ce document, eux, suivent le déplacement : voir
l'avertissement du § 8.

---

## 2. Les trois unités en détail

### 2.1 Le serveur

`src/server/` et le binaire sont des **ES modules** : la racine porte
`"type": "module"` (`package.json`).

```
bin/agent-viz.js                  le binaire
src/server/                       HTTP, SSE, table de routes, tarification d'affichage ;
                                  les commandes du binaire (hook.ts · install-hooks.ts ·
                                  lifecycle.ts · prompt-install.ts) et le démon (server.ts)
src/server/install-hooks/         l'installation des hooks, par agent (Claude / Copilot) et par portée
src/server/observatory/           orchestration des scans, base, provenance
src/server/observatory/rules/     les règles de conseil, une par fichier
src/server/transcript-adapters/   Claude / Copilot, un contrat commun
src/server/watchdog/              surveillance et alertes
```

```
find src/server -type d           → src/server et les sous-dossiers nommés ci-dessus, aucun autre
```

La table de routes du serveur est **déclarative** (`ROUTES`, dans
`src/server/routes.ts`) : ajouter une route est une ligne de données, pas une
branche de plus dans un aiguilleur. C'est le précédent que [CLAUDE.md](./CLAUDE.md)
cite pour le principe ouvert/fermé.

### 2.2 Le moteur

TypeScript `strict`, ES modules, compilés par `tsc` vers `dist/engine/`, dans le
même build que le serveur (§ 4).

```
src/engine/core/       lecture JSONL, découverte de sessions, usage, tarifs
src/engine/doctor/     les règles de diagnostic, leurs agrégateurs, leur rapport
src/engine/cli.ts      le binaire `netgain`
```

La racine du dépôt porte `{"type": "module"}` (`package.json`) : `src/engine/`
est ES modules directement, sans marqueur de sous-arbre à maintenir. Aucun
`package.json` ne vit sous `src/`, ni pour le moteur ni pour le navigateur :

```
find src -name package.json           → vide
```

### 2.3 Le navigateur

**Des modules `.ts` et une seule feuille de style, `viz.css`.** ES modules,
servis en JavaScript, les types retirés à la requête
(`node:module.stripTypeScriptTypes`, mode `strip`), en HTTP depuis `src/web/`
(l'entrée `prefix: '/src/web/'` de `ROUTES`, dans `src/server/routes.ts`).

```
find src/web -type f ! -name "*.ts"   → src/web/viz.css
```

```
src/web/               viz-state · viz-canvas · viz-layout · viz-ui · viz-network
src/web/observatory/   les trois vues d'analyse : conseils, sessions, tarifs
                       (trois vues d'un seul document — il n'y a qu'un `.html`)
```

**L'URL suit le disque** : la racine statique est `src/web/` (`staticHandler`)
et le préfixe servi est `/src/web/` (l'entrée `prefix` de `ROUTES`). Il n'y a
aucune table de correspondance URL→disque : le serveur sert la source `.ts`
directement, les types retirés à la requête. **Il n'existe aucun `dist/web/`** :
le build ne compile que `src/engine/` et `src/server/` (`include` de
`tsconfig.build.json`).

Il ne parle au serveur que par le réseau, et depuis **trois fichiers** :

| Fichier | Ce qu'il ouvre |
|---|---|
| `src/web/viz-network.ts` | le flux SSE `/stream` (`connectSSE`) et les appels du temps réel |
| `src/web/observatory/api.ts` | le client HTTP des trois vues d'analyse |
| `src/web/viz-watchdog-client.ts` | les alertes de surveillance |

Aucun autre module n'ouvre le réseau. **Cette frontière-là piège la mesure trois
fois**, et les trois pièges valent d'être écrits parce qu'ils reviendront à
chaque fois qu'on voudra la contrôler automatiquement :

```
grep -rl "fetch" src/web/     → 7 fichiers
```

| Les 7 fichiers | Ce qu'ils font réellement |
|---|---|
| `viz-network.ts`, `viz-watchdog-client.ts` | appellent `fetch` / `EventSource` — les seuls que `grep "fetch("` trouve |
| `observatory/api.ts` | reçoit `fetchImpl = fetch` en **paramètre par défaut**, par injection ; `grep "fetch("` le manque |
| `observatory/store.ts`, `observatory/advisor-view.ts` | appellent des méthodes **nommées** `api.fetchSummary`, `api.fetchAlerts`… sur le client injecté : ils ne sortent pas, ils délèguent |
| `viz-layout.ts`, `viz-narrator.ts` | ne portent le mot que dans un commentaire, qui dit qu'ils n'en font justement pas |

Trois fichiers sortent, quatre ressemblent à des sortants. Un contrôle de
frontière écrit contre le mot `fetch` se trompe donc dans les deux sens à la
fois.

**Deux** sorties non-réseau existent par ailleurs, et aucune ne contredit la
table du § 1 — ce sont des API du navigateur, pas du disque :
`observatory/failures-view.ts` (`navigator.clipboard.writeText`) et
`notifyDesktop`, dans `viz-ui.ts`, qui demande la permission puis lève une
**notification système** (`new Notification(...)`). La seconde sort de la page plus visiblement
que la première.

---

## 3. La règle de dépendance

Une phrase, et c'est le seul invariant structurel du produit :

> **Le serveur appelle le moteur. Le navigateur ne parle qu'HTTP. Le moteur
> ignore les deux autres.**

Un sens unique, jamais de retour, **sur le réseau**. Le **graphe d'import**,
lui, compte deux sortes de liens :

- **les imports en valeur**, que le navigateur demande au serveur. Hors de
  `src/web/`, ils n'atteignent que les primitives du moteur que la table `ROUTES`
  de `src/server/routes.ts` nomme par chemin exact et sert par
  `engineStaticHandler`. La liste se lit dans la table, une ligne par primitive :
  `grep -n "handler: engineStaticHandler" src/server/routes.ts`. Le navigateur
  les reçoit par la même route HTTP que ses propres modules, jamais par un
  chargeur Node : ce n'est pas une fuite.
- **les imports de type**, écrits `import type { … } from '…'`, que le serveur
  efface en retirant les types à la requête : la ligne devient blanche et aucun
  fichier n'est demandé. Ils peuvent viser le moteur et le serveur. Un type
  décrit ce que le serveur envoie sur le réseau, et il se lit à sa source au
  lieu d'être recopié. Ce lien va dans le même sens que le réseau : le
  navigateur lit le contrat du serveur, et le serveur n'importe jamais le
  navigateur.

L'invariant réseau tient. L'invariant d'import se contrôle sur les liens en
valeur, liste blanche comprise. Le moteur, lui, n'importe rien du produit,
types compris.

Trois règles l'établissent, et **chacune vient avec son contrôle négatif** :
une commande dont la sortie vide est la preuve doit d'abord prouver qu'elle
*sait* ne pas être vide, et un test doit prouver qu'il sait rougir :

```sh
# 1. Le moteur n'atteint pas le produit.
grep -rEn "from ['\"].*(\.\./)+(src/)?(server|web)/" src/engine/      # → vide, exit 1
echo "import x from '../../server/usage.js'" \
  | grep -En "from ['\"].*(\.\./)+(src/)?(server|web)/"              # → 1 ligne, exit 0

# 2. En valeur, le navigateur n'atteint hors de src/web/ que les primitives du
#    moteur nommées par ROUTES, et jamais src/server/. Les lignes
#    `import type { … } from` sont permises vers le moteur et le serveur, parce
#    que le retrait des types les efface. Un test tient cette règle, pas un grep.
npm test -- tests/repo/served-web-graph.test.mjs                    # → tous passés, exit 0
#    Contrôles négatifs, dans le même fichier : R5 vérifie d'abord que son
#    prédicat signale `src/server/pricing.ts`, et le test « frontière de type »
#    vérifie qu'un import en valeur écrit sur trois lignes est vu et que seul
#    `import type` est mis de côté.

# 3. Le navigateur n'importe aucune API Node.
grep -rEn "^[[:space:]]*import .* from ['\"]node:" src/web/          # → vide, exit 1
echo "import fs from 'node:fs'" \
  | grep -En "^[[:space:]]*import .* from ['\"]node:"                # → 1 ligne, exit 0
```

Les commandes des règles n° 1 et n° 3 rendent vide (`exit 1`), et leurs
contrôles négatifs rendent chacun leur ligne (`exit 0`). Le test de la règle
n° 2 porte ses propres contrôles négatifs.

**Pourquoi la règle n° 2 est tenue par un test et non par un `grep`.** Un `grep`
lit le texte ligne par ligne, et il se trompe sur cette règle de trois façons :

- sa liste blanche est recopiée dans son filtre : chaque primitive ajoutée à
  `ROUTES` doit y être ajoutée à la main, et aucun test ne signale l'oubli ;
- il ne voit pas un import écrit sur plusieurs lignes, une forme courante dans
  `src/web/`, que `grep -rnE "^import (type )?\{[[:space:]]*$" src/web/` montre :
  `import {`, `getPrice,`, `} from '../server/pricing.ts'` le laissent muet,
  alors que le test rougit ;
- il ne distingue pas `import type { X } from`, effacé au service, de
  `import { type X } from`, qui fait demander le fichier.

Le test lit l'arbre syntaxique, suit le graphe de fichier en fichier et lit la
liste blanche dans `ROUTES` au lieu de la recopier. Il compare aussi, fichier
par fichier, son classement type / valeur au vrai retrait des types.

| Forme écrite dans `src/web/` | Ce que le serveur envoie | Nature du lien |
|---|---|---|
| `import type { X } from './m.ts';` | une ligne blanche | type : permis vers le moteur et le serveur |
| `import { type X } from './m.ts';` | `import { } from './m.ts';` | valeur : le fichier est demandé |
| `import { v, type X } from './m.ts';` | `import { v, } from './m.ts';` | valeur |

**Ce que ces règles NE regardent PAS.** Les commandes des règles n° 1 et n° 3
portent sur des **instructions d'import statiques**, et c'est délibéré (le
paragraphe suivant dit pourquoi un contrôle textuel se trompe dans les deux
sens). Le test de la règle n° 2 lit aussi les `import()`. Mais une commande
dont on ignore la portée finit par servir de preuve de ce qu'elle ne
regarde pas, donc :

- **la règle n° 2 suit un `import()` dont le chemin est une chaîne écrite en
  toutes lettres. Un `import()` dont le chemin est calculé arrête la marche, et
  le test le signale (R0).** `typeof import('./api.ts')`, que `advisor-view.ts`
  et `store.ts` écrivent (`grep -rn "typeof import(" src/web/`), est une requête
  de type, effacée au service, et le test la met de côté ;
- **la règle n° 3 ne voit que `import X from 'node:…'`** — `import 'node:fs'`,
  `require('node:fs')` et `await import('node:fs')` lui échappent tous les trois.

Le second angle mort est **sans victime** : la commande ci-dessous voit les
trois formes et rend vide, et son contrôle négatif rend les trois lignes :

```sh
grep -rnE "(^|[^A-Za-z0-9_])(import|require)[[:space:]]*\(?[[:space:]]*['\"]node:" src/web/
                                                                         # → vide, exit 1
printf "import 'node:fs'\nrequire('node:path')\nawait import('node:os')\n" \
  | grep -nE "(^|[^A-Za-z0-9_])(import|require)[[:space:]]*\(?[[:space:]]*['\"]node:"
                                                                         # → 3 lignes
```

**Zéro victime n'est pas zéro risque.** Ces deux formes échappent au grep, et le
compilateur ne les refuse pas non plus : `src/web/` partage le seul
`tsconfig.json` du projet et reçoit `"types": ["node"]` avec le reste, donc un
`import fs from 'node:fs'` direct dans le navigateur compile. Ce qui les tient
est un test de graphe, `tests/repo/served-web-graph.test.mjs` : sa règle R1
refuse tout spécificateur non relatif — `node:` ou paquet nu — atteint depuis
`src/web/`, directement ou par transitivité, en nommant le fichier et le
spécificateur. Aucun outil de lint ne le remplace : ESLint ne franchit pas un
import, le cas transitif lui échappe (mesuré sur trois configurations), et le
dépôt n'a aucune configuration ESLint.

**Pourquoi les contrôles négatifs sont écrits là plutôt que sous-entendus.** Sous
`grep -E`, `\|` n'est pas une alternation mais un **tube littéral** : un motif
`(server\|web)/` cherche la chaîne `server|web/`, ne trouve aucun import réel, et
sa sortie vide se lirait comme une preuve. Le fait affirmé pourrait être vrai,
mais la commande censée l'établir serait incapable d'échouer. Le contrôle
négatif le montre :

```sh
echo "import x from '../server/usage.js'" | grep -cE "(server\|web)/"   # → 0
echo "import x from '../server/usage.js'" | grep -cE "(server|web)/"    # → 1
```

**Le troisième cas mérite en plus son paragraphe, parce qu'un contrôle naïf se
trompe dans l'autre sens.** `grep -rn "node:" src/web/` rend des lignes, et
aucune n'est un import : ce sont des paramètres TypeScript nommés `node`,
annotés par leur type (`node: HTMLElement`, `node: VizNode`). `node` comme nom
de paramètre (un nœud du DOM ou du graphe) est un choix ordinaire ; le `:` qui
le suit est la syntaxe de type elle-même. Un contrôle qui chercherait la chaîne
`node:` signalerait donc des fautes qui n'en sont pas. Le contrôle juste porte
sur les **instructions d'import**, pas sur le texte des fichiers. Que chaque
ligne rendue soit un paramètre typé se vérifie ainsi :

```sh
grep -rn "node:" src/web/ | grep -vE "node: [A-Z][A-Za-z]*"          # → vide, exit 1
echo "import fs from 'node:fs'" | grep -vE "node: [A-Z][A-Za-z]*"    # → 1 ligne, exit 0
```

**La règle n° 2 est tenue par un test de dépôt, `tests/repo/served-web-graph.test.mjs`.**
Les règles n° 1 et n° 3 gardent leurs commandes, rejouées à la main. La règle
n° 3 est aussi tenue par la règle R1 du même test, qui refuse tout import
`node:` atteint depuis `src/web/`, directement ou par transitivité. R1 ne voit
pas une API Node atteinte sans import (`process.env`, `globalThis.require`).

---

## 4. La frontière serveur → moteur

**Le serveur importe la source du moteur**, par des `import` statiques aux
chemins relatifs en `.ts`. Il n'y a ni pont, ni chargeur, ni liste de noms écrite
à la main : un nom qui disparaît du moteur est une erreur de `npm run typecheck`.
Extrait de la sortie :

```
git grep -nE "from '(\.\./)+engine/" -- src/server
  src/server/tokens.ts:21:import { addUsage, countOrZero, emptyUsageBucket, isDedupableMsgId, usageVerdict } from '../engine/core/usage.ts';
  src/server/observatory/engine.ts:12:import { discoverSessions, parseSince, priceTable } from '../../engine/core/index.ts';
  src/server/transcript.ts:13:import { decodeJsonlLine } from '../engine/core/jsonl.ts';
```

Une primitive du moteur n'a qu'une définition : un fichier de `src/server/` qui
en redéfinit une localement fait rougir `tests/repo/no-local-engine-primitives.test.mjs`.

`src/server/observatory/engine.ts` construit, au chargement du module, la valeur
`engine` : les cinq fonctions du moteur que l'observatoire reçoit
(`discoverSessions`, `parseSince`, `scanSession`, `netTokens`, `priceTable`) et la
version du produit. La racine de composition `src/server/observatory/index.ts` la
passe au service : les règles et l'orchestration la reçoivent en paramètre, ce qui
les rend testables avec une doublure (un faux moteur écrit dans le test). Les
imports sont statiques : un fichier compilé du moteur absent empêche ce module de
se charger, et aucune route ne traite de moteur absent. Toute panne du service
répond 500 avec son message exact.

**Un seul build produit les deux arbres compilés.** `npm run build` efface
`dist/engine` et `dist/server`, puis lance `tsc -b tsconfig.build.json` —
`rootDir` `src`, `outDir` `dist`, `include` `src/engine/**/*.ts` et
`src/server/**/*.ts`. Les imports en `.ts` sortent en `.js`
(`rewriteRelativeImportExtensions`, dans `tsconfig.json`) :
`dist/server/tokens.js` importe `../engine/core/usage.js`. Le binaire charge
`dist/`, jamais la source.

**Une garde dans le binaire le rappelle** : `ensureBuildIsFresh`
(`bin/agent-viz.js`), appelée avant l'aiguillage des commandes.

| Situation | Ce que fait la garde |
|---|---|
| un fichier compilé requis manque (`REQUIRED_DIST_FILES` : les modules des commandes sous `dist/server/`, `dist/engine/core/index.js`, `dist/engine/doctor/index.js`) | arrête, `exit 1`. Dans un dépôt de développement (`src/server/` présent), le message nomme `npm run build` ; sur un paquet installé, une réinstallation |
| dépôt de développement, un `.ts` de `src/engine/` ou de `src/server/` est plus récent que le témoin `dist/tsconfig.build.tsbuildinfo` | avertit sur la sortie d'erreur, et la commande continue |
| dépôt de développement, le témoin est absent | avertit qu'elle ne peut pas juger de la fraîcheur, et la commande continue |
| paquet installé (pas de `src/server/`), ou commande `hook` | ne fait que le contrôle des fichiers manquants : aucun avertissement de fraîcheur |

**Ce que la garde ne voit pas.** Elle contrôle six fichiers témoins
(`REQUIRED_DIST_FILES`), pas l'inventaire de `dist/`, et elle compare des
présences et des dates, pas l'issue du build.

| Situation | Qui la signale |
|---|---|
| `dist/` vidé par un build interrompu (le build efface `dist/engine` et `dist/server` avant de compiler) | la garde : les témoins manquent, `exit 1` |
| un fichier compilé isolé manque, hors des six témoins, dans ce que charge une commande | Node, au chargement du module : sortie 1 et le chemin du fichier, avant que la commande agisse. Exception : `stop` arrête le démon avant de charger `install-hooks.js` |
| un fichier compilé isolé manque dans ce que charge le démon, `dist/server/server.js` compris | le démon sort au démarrage ; `start` rend `exited during startup` et la fin du journal, où Node nomme le fichier. Exception : le détecteur du chien de garde, chargé à part — le démon démarre sans surveillance des pannes et ne s'en plaint que dans le journal |
| `npm run build` en erreur | sa propre sortie — les erreurs de `tsc` et un code de sortie non nul —, jamais la garde |

`tests/repo/build-guards.test.mjs` rejoue les situations de la garde sur un arbre
synthétique hors du dépôt.

**La frontière du navigateur est tenue par trois filets de dépôt**, qui lisent
la table `ROUTES` de `src/server/routes.ts` au lieu d'en recopier une :

| Filet | Ce qu'il tient |
|---|---|
| `tests/repo/served-web-graph.test.mjs` | le graphe d'imports en valeur atteignable depuis `src/web/` : uniquement des chemins relatifs en `.ts` qui existent ; chaque module atteint hors de `src/web/` est servi par `ROUTES` (R4) et se trouve dans `src/engine/`, jamais dans `src/server/` (R5) ; les lignes `import type` sont mises de côté parce que le serveur les efface. |
| `tests/repo/served-ts-strip-check.test.mjs` | chaque fichier servi, types retirés par le même chemin que la requête HTTP, passe `node --check` ; aucun préfixe de route ne recouvre `/src/engine/` |
| `tests/repo/package-entrypoints.test.mjs` | chaque route `/src/engine/…` figure dans le champ `files` de `package.json`, donc dans le paquet publié |

---

## 5. Les deux flux de données

Ils ne partagent ni source, ni durée de vie, ni mode de panne. Les confondre est
la principale façon de se tromper sur ce produit.

### Flux A — la capture temps réel

```
Claude Code / Copilot CLI
   └─ le hook lance `agent-viz hook`
        ├─ écrit  ${tmpdir}/agent-events/<session>.jsonl     (hook.ts : DIR, runHook)
        └─ POST /notify au démon, sans attendre la réponse
              └─ le démon diffuse en SSE sur /stream          (routes.ts : streamHandler)
                    └─ la page se met à jour                  (viz-network.ts : connectSSE)
```

Chaud, éphémère, purgé toutes les heures (`housekeep`, programmé dans
`src/server/server.ts`). Le hook **n'attend jamais** le démon : un démon éteint
ne ralentit pas la session de l'utilisateur.

### Flux B — l'observatoire

```
~/.claude/projects/<projet>/<session>.jsonl        (la source de vérité)
   └─ le moteur découvre, décode, agrège, tarife    (src/engine/core/discovery.ts : discoverSessions)
        └─ le serveur range le résultat dans
           ~/.agent-viz/observatory.db               (observatory/index.ts : DB_PATH)
              └─ servi en JSON par HTTP
                    └─ les trois pages d'analyse     (src/web/observatory/)
```

Froid, rejoué au démarrage puis toutes les heures (`runAnalysisScan`, programmé
dans `src/server/server.ts` à la même cadence que la purge du flux A : deux
objets différents). **Les transcripts sont la source de vérité ; la base est un
dérivé jetable.** La supprimer ne perd que les statuts posés à la main sur les
recommandations.

---

## 6. Les points d'entrée

Ils se comptent en deux temps, et les confondre fait manquer un hook.

**Ce que le paquet déclare** — `package.json` :

| Entrée | Fichier | Appelée par |
|---|---|---|
| `agent-viz` | `bin/agent-viz.js` | l'utilisateur |
| `netgain` | `dist/engine/cli.js` | l'utilisateur |
| `main` | `dist/server/server.js` | déclaré pour `require('@vcueto/agent-viz')`, qu'aucun code de ce dépôt n'appelle — mais le fichier lui-même est bien vivant : c'est l'émission du script que le démon lance (`SERVER_SCRIPT`, dans `src/server/lifecycle.ts`). **Ce qu'il rend à un appelant CommonJS est dit juste sous cette table.** |
| la page | `index.html` | le navigateur ; importe ses modules depuis `./src/web/…` |

**Ces points d'entrée sont des ES modules, et un seul d'entre eux le rend
visible de l'extérieur.** `bin/agent-viz.js` et `dist/server/server.js` sont des
ES modules parce que la racine porte `"type": "module"` ; lancés par `node`, ils
n'en montrent rien. Mais `main` est aussi une **surface d'appel** : un projet
CommonJS qui écrit `require('@vcueto/agent-viz')` reçoit un **espace de noms de
module**, et non un objet `module.exports` ; y affecter une propriété est sans
effet et sans erreur en mode non strict. Aucun test ne peut l'attraper : rien,
dans ce dépôt, n'appelle `require('@vcueto/agent-viz')`.

```
git grep -nF "require('@vcueto/agent-viz')" -- src bin tests     → vide, exit 1
```

**Un test permanent tient les trois premières lignes de cette table**, plus
chaque entrée du champ `files` — `tests/repo/package-entrypoints.test.mjs` : elles
doivent résoudre sur le disque. Ni le typecheck ni le build ne lisent ces
entrées, et **npm ignore en silence une entrée `files` inexistante** : `npm pack`
rend `exit 0` sans la nommer. Ce qu'il ne dit pas : que le point d'entrée
*s'exécute*. Résoudre n'est pas tourner : `tests/repo/bin-help.test.mjs` lance
`bin/agent-viz.js` dans un vrai sous-processus, mais aucun test ne lance
`dist/engine/cli.js`.

**Ce que l'agent invoque tout seul** — un hook, sur un seul binaire :

| Hook | Commande inscrite | Événement |
|---|---|---|
| agent-viz | `node "<abs>/bin/agent-viz.js" hook --source=claude\|copilot` **ou** `npx --yes @vcueto/agent-viz@X.Y.Z hook --source=…` | les événements Claude / Copilot |

Le hook agent-viz a **deux modes**, et la différence compte : si la racine du
paquet est un cache `npx` éphémère, la commande écrite ne contient **aucun
chemin** (`resolveHookCommand`, dans `src/server/install-hooks/scopes.ts`).
L'installation globale ou locale produit la forme absolue ; `npx` produit la
forme portable.

Ce que ce dépôt n'établit pas : **sous quelle forme Claude Code ou Copilot CLI
remontent à l'utilisateur l'échec d'un hook** dont la commande ne trouve plus son
fichier. Rien ici ne le teste.

### Le produit écrit chez son utilisateur — en deux endroits de natures différentes

C'est le point le plus rigide du produit, et l'inventaire en est plus large qu'il
n'y paraît.

| Qui écrit | Où | Chemin absolu ? |
|---|---|---|
| `src/server/install-hooks/` | **six** destinations possibles selon l'agent et la portée : `~/.claude/settings.json`, `<dépôt>/.claude/settings{,.local}.json`, `~/.copilot/hooks/agent-viz.json`, `<dépôt>/.github/hooks/agent-viz{,.local}.json` | **seulement en mode `absolute`** |
| `src/server/install-hooks/` | ajoute une ligne au **`.gitignore` du dépôt de l'utilisateur**, quand il écrit un fichier de portée locale — jamais n'en crée un (`ensureGitignore`, dans `scopes.ts`) | sans objet |

La deuxième ligne est la plus intrusive des deux : c'est la seule qui touche un
fichier **versionné** de l'utilisateur.

Pour Claude Code, l'installation reconnaît **quatre formes** de sa propre ligne
(`isAgentVizHook`, dans `src/server/install-hooks/settings-io.ts`) : deux formes
anciennes, qui nomment un `hook.js`, et **deux formes courantes**, une par mode.
Une ligne reconnue n'est jamais doublée : l'installation la réécrit quand elle a
la forme standard (`node "…"` ou `npx …`, `isStandardShape`), et la laisse telle
quelle sinon. Pour Copilot CLI, toute commande qui nomme `agent-viz` et `hook`
est reconnue (`isAgentVizCommand`, dans `copilot.ts`) et remplacée sur place.

---

## 7. Ce qui est source, ce qui est dérivé

Aucun de ces artefacts n'est une source de vérité. Aucun n'est versionné.
Les supprimer est toujours sans danger.

| Artefact | Produit par | Reconstruit par |
|---|---|---|
| `dist/server/` et `dist/engine/` | `npm run build` (nettoyage des deux, puis `tsc -b`) | `npm run build` |
| `~/.agent-viz/observatory.db` | les scans | le scan suivant |
| `${tmpdir}/agent-events/*.jsonl` | le hook | la session suivante |

Corollaire pour qui développe : **après avoir modifié le serveur ou le moteur, il
faut reconstruire.** Le binaire charge `dist/server/` et `dist/engine/`, pas la
source. La garde de `bin/agent-viz.js` le rappelle (§ 4) : elle arrête sur un
fichier compilé manquant, et avertit quand une source `.ts` est plus récente que
le dernier build.

**Le build commence par effacer `dist/engine` et `dist/server`** (`package.json`,
script `build`), parce que `tsc` ne vide jamais son `outDir` : un fichier compilé
dont la source a disparu resterait dans `dist/`, et partirait dans le tarball
**en silence, `exit=0`**. `prepare` exécute `build` chez qui installe depuis un
dépôt git : l'effacement a lieu chez lui aussi.

---

## 8. Adresses

**C'est la seule section dont un déplacement de fichiers change le SENS** — le
reste est écrit en termes de responsabilités, qui ne bougent pas.

**Ce n'est pas la seule qu'un déplacement RÉÉCRIT.** Les autres sections
**citent** des chemins sans porter sur eux : commandes de contrôle, tables de
fichiers, ancrages `fichier:ligne`. Une responsabilité ne bouge pas ; l'adresse
par laquelle on la montre, si. **Rouvrir le seul § 8 après un déplacement
laisserait le reste mentir** — et le mensonge serait invisible, puisque chaque
phrase resterait grammaticalement vraie.

| Unité | Répertoires |
|---|---|
| serveur | `src/server/` → `dist/server/`, et `bin/` |
| moteur | `src/engine/` → `dist/engine/` |
| navigateur | `src/web/` |

`tests/repo/stale-path-citations.test.mjs` rougit quand ce document cite un
fichier `.ts`, `.js`, `.mjs` ou `.cjs` de `src/server/`, `src/engine/` ou
`src/web/` qui n'existe pas. Il ne vérifie ni un dossier ni un numéro de
ligne : un ancrage `fichier:ligne` qui a glissé reste vert.

---

## 9. La plomberie de test

**Un seul exécuteur, un seul arbre de tests dans 131 fichiers.**

```
npx vitest run     → tous passés, 131 fichiers
```

Les deux exécuteurs ne lisent que `tests/` (`include` de `vitest.config.mts`,
motif du script `test:node`), et ce dossier porte **deux dialectes** : c'est ce
qui explique le pont ci-dessous.

| Dialecte | Fichiers | Écrits en |
|---|---|---|
| CommonJS + ESM | 0 `.test.cjs` + 17 `.test.mjs` | `node:test` |
| TypeScript | 114 `.test.ts` | l'API de vitest |

**L'extension dit le régime.** Sous une racine `"type": "module"`, un `.js`
**est** un module ES, où `require()` n'existe pas : un test CommonJS s'écrit en
`.test.cjs`, un test ESM pour `node:test` en `.test.mjs`. Un fichier `.test.js`
sous `tests/` ne serait lu par aucun des deux exécuteurs, qui ne lisent que
`.test.cjs`, `.test.mjs` et, pour vitest, `.test.ts` ;
`tests/repo/test-file-extensions.test.mjs` le refuse.

**Les fichiers en `node:test` passent par un pont** (`test-support/bridge/`),
qui rend la surface `node:test` au-dessus des primitives de vitest. Leur nombre
est écrit une seule fois, à côté de la commande qui le refait, et
`tests/repo/architecture-test-counts.test.mjs` le compare au disque :

```
grep -rlE "(require\(|from )['\"]node:test['\"]" tests | wc -l   → 17
```

Le test du pont, `tests/unit/node-test-bridge.test.mjs`, passe lui-même par le
pont quand il tourne sous vitest. Le décompte du pont **grandit à chaque fichier
`node:test` neuf, et baisse quand un fichier change de dialecte ou quitte
l'arbre** : un total recopié ailleurs dans ce document vieillirait au fichier
suivant sans que rien ne rougisse.

Le pont est en trois fichiers, et sa forme n'est pas un choix esthétique — elle
est imposée par le fait qu'**une seule couture ne suffit pas** :

| Fichier | Rôle |
|---|---|
| `create-bridge.mjs` | la **fabrique pure** : reçoit ses primitives par injection, se teste seule, ne connaît ni vitest ni `node:module` |
| `install.mjs` | couture n° 1 : détourne `Module._load` — atteint les `require('node:test')` des fichiers CommonJS |
| `node-test-alias.mjs` | couture n° 2 : cible d'un `resolve.alias` de `vitest.config.mts` — atteint les `import … from 'node:test'` des fichiers ESM |

La seconde ne remplace pas la première, elle s'y ajoute : la résolution ESM ne
passe pas par le hook CommonJS. Un pont amputé de l'une des deux laisse non
exécutés, **sans le dire**, les fichiers du régime qu'elle atteint — c'est mesuré,
pas supposé.

Le pont **refuse en se nommant** les **15 API** qu'il sait ne pas implémenter
(`NON_IMPLEMENTE_MODULE` et `NON_IMPLEMENTE_CONTEXTE` dans `create-bridge.mjs`) :
`describe`, `it`, `test.skip`, `t.test`… Jamais un no-op. C'est un **inventaire
figé**, relevé sur ce que `tests/` utilisait réellement, et non une garde
générale : il n'y a pas de `Proxy`, donc une API de `node:test` hors de cette
liste vaudrait `undefined` sans se signaler. Étendre le filet, c'est allonger ces
deux listes.

`npm run test:node` exécute les mêmes tests `node:test` **nativement**,
sous `node --test`. Ce n'est pas une redondance : c'est la **sémantique de référence**
à laquelle le pont est comparé. Si plus rien ne l'exerçait, elle pourrait cesser
de passer sans que rien ne l'annonce. La publication lance les deux.

**Les sources du moteur se chargent sous les deux exécuteurs.** `src/engine/**`
nomme ses voisins en `.ts`, comme `src/server/**`, et Node 24 retire les types à
l'import : un test `node:test` peut charger une source du moteur et tourner sous
vitest comme sous `node --test`. `tests/unit/pricing.test.cjs`
charge `src/engine/core/pricing.ts` et passe dans les deux suites.

```
grep -rhoE "from ['\"]\.[^'\"]*\.js['\"]" src/engine | wc -l                      → 0
echo "import x from './core/usage.js'" | grep -cE "from ['\"]\.[^'\"]*\.js['\"]"  → 1
```

Le dialecte d'un test ne dépend donc pas de ce qu'il importe, seulement de l'API
qu'il emploie : `tests/doctor/verification.test.ts` est un `.test.ts` parce qu'il
écrit `import { test } from 'vitest'`. Le filet `tests/repo/relative-specifiers-exist.test.mjs`
le tient : dans un `.ts` de `src/` ou de `tests/`, un spécificateur relatif désigne un
fichier qui existe, ce qui refuse le `./x.js` que vitest résout seul vers `./x.ts` et
que Node ne résout pas. L'inverse — un `.test.ts` qui importe
`node:test` — est un **hybride** : il se lit comme couvert par les deux et n'est
lu que par un. Le dépôt n'en compte aucun
(`grep -rlE "(require\(|from )['\"]node:test['\"]" tests --include="*.test.ts" | wc -l` → 0).

**Un garde d'environnement est posé au HARNAIS, pas dans les tests** —
`test-support/env-guard.mjs`, première entrée des `setupFiles` de vitest et
`--import` des deux scripts `node --test`. Il détourne `HOME`, `USERPROFILE`,
`TEMP` et `TMP` vers un bac jetable et force un port mort avant qu'une seule
ligne de test s'exécute. Sa raison est mesurée : plusieurs tests chargent des
modules qui, sous une garde qui lâche, écriraient dans le
`~/.claude/settings.json` **réel** de la machine et rouvriraient la base de
l'observatoire. Le mettre au harnais plutôt que dans chaque test **empêche** la
fuite au lieu de la **constater**.

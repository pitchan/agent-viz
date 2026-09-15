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
est ES modules directement, sans marqueur de sous-arbre à maintenir. Avant
l'étape 3, un marqueur `{"type": "module"}` versionné rendait ce sous-arbre ESM
à l'intérieur d'une racine CommonJS, avec un jumeau écrit par le build dans
`dist/engine/` ; les deux ont disparu avec la racine ESM.

### 2.3 Le navigateur

**28 fichiers** — 27 `.ts`, `viz.css`. ES modules, servis en JavaScript, les
types retirés à la requête (`node:module.stripTypeScriptTypes`, mode `strip`),
en HTTP depuis `src/web/` (`src/server/routes.ts:373`).

```
find src/web -type f | wc -l          → 28      (27 ts · 1 css)
```

**Le 28ᵉ était le marqueur, et il a disparu à l'étape 3.** Ce répertoire portait
lui aussi un `package.json` de deux lignes, `{ "type": "module" }`, dont le seul
travail était de rendre ce sous-arbre ESM sous une racine CommonJS ; la bascule
de la racine l'a rendu inutile, comme celui du moteur. Le décompte de fichiers
baisse donc **sans qu'aucun module disparaisse** — c'est exactement la classe
d'erreur contre laquelle le § 0 met en garde, et elle est écrite ici plutôt que
subie.

```
src/web/               viz-state · viz-canvas · viz-layout · viz-ui · viz-network
src/web/observatory/   les trois vues d'analyse : conseils, sessions, tarifs
                       (trois vues d'un seul document — il n'y a qu'un `.html`)
```

**L'URL suit le disque** : la racine statique est `src/web/` et le préfixe servi
est `/src/web/` (`routes.ts:373` et l'entrée `prefix` de `ROUTES`). Une table de
correspondance URL→disque aurait été un mécanisme neuf ; l'étape 5 n'en crée
pas — elle sert la source `.ts` directement, les types retirés à la requête.
**Il n'existe aucun `dist/web/`, et ce chantier n'en crée pas** : c'est la cible
abandonnée (doc/48).

Il ne parle au serveur que par le réseau, et depuis **trois fichiers** :

| Fichier | Ce qu'il ouvre |
|---|---|
| `src/web/viz-network.ts` | le flux SSE `/stream` (l. 111) et les appels du temps réel |
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
`observatory/failures-view.ts:88` (`navigator.clipboard.writeText`) et
`viz-ui.ts:768-777`, qui demande la permission puis lève une **notification
système** (`new Notification(...)`). La seconde sort de la page plus visiblement
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

Trois règles l'établissent, et **chacune vient avec son contrôle négatif** —
parce qu'une commande dont la sortie vide est la preuve doit d'abord prouver
qu'elle *sait* ne pas être vide :

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

Le second angle mort est **sans victime aujourd'hui**, vérifié en exécutant —
et sa commande est écrite hors tableau, pour la raison dite juste après :

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

Le déplacement a d'ailleurs **changé la forme** de la deuxième : avant, le moteur
s'atteignait par `../netgain/dist/`, un segment que `(\.\./)*(lib|netgain)/`
attrapait. Aujourd'hui il s'atteint par sa source, `../engine/core/…` —
l'ancien motif serait **muet**, et muet n'est pas la même chose que vrai.

**Pourquoi les contrôles négatifs sont écrits là plutôt que sous-entendus.** La
première rédaction de cette section portait un motif `(lib\|netgain)` sous
`grep -E`, où `\|` n'est pas une alternation mais un **tube littéral** : la
commande cherchait la chaîne `lib|netgain`, ne pouvait rien trouver, et sa sortie
vide se lisait comme une preuve. Le fait affirmé était vrai — mais par accident,
et la commande censée l'établir était incapable d'échouer.

**Le troisième cas mérite en plus son paragraphe, parce qu'un contrôle naïf se
trompe dans l'autre sens — et le sens dans lequel il se trompe a changé avec le
langage.** Avant l'étape 5, `grep -rn "node:" src/web/` rendait une ligne,
`viz-invocation-patterns.mjs:193` : une expression régulière reconnaissant
`node:internal/` dans le texte d'une trace d'erreur affichée à l'écran — et ce
fichier a depuis quitté `src/web/` pour le moteur (§ 2.3, § 6). **Aujourd'hui
la même commande rend sept lignes, et aucune n'est un import** : ce sont des
paramètres TypeScript nommés `node`, annotés par leur type —
`node: HTMLElement` dans `advisor-view.ts` (deux fois), `confirm-button.ts`,
`decisions-view.ts`, `failures-view.ts`, `period-selector.ts`, et
`node: VizNode` dans `viz-layout.ts`. `node` comme nom de paramètre (un nœud du
DOM ou du graphe) est un choix ordinaire ; le `:` qui le suit est la syntaxe de
type elle-même. Un contrôle qui chercherait la chaîne `node:` mentirait donc
sept fois au lieu d'une, pour une raison sans rapport avec la précédente. Le
contrôle juste porte sur les **instructions d'import**, pas sur le texte des
fichiers — et le passage à TypeScript en est un argument de plus, pas
seulement une note d'histoire.

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
  src/server/tokens.ts:21:import { addUsage, countOrZero, emptyUsageBucket, isDedupableMsgId } from '../engine/core/usage.ts';
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
        ├─ écrit  ${tmpdir}/agent-events/<session>.jsonl     (dossier : hook.ts:25
        │                                                     écriture : hook.ts:82)
        └─ POST /notify au démon, sans attendre la réponse
              └─ le démon diffuse en SSE sur /stream          (routes.ts:379)
                    └─ la page se met à jour                  (viz-network.ts:111)
```

Chaud, éphémère, purgé toutes les heures (`src/server/server.ts:84`). Le hook
**n'attend jamais** le démon : un démon éteint ne ralentit pas la session de
l'utilisateur.

### Flux B — l'observatoire

```
~/.claude/projects/<projet>/<session>.jsonl        (la source de vérité)
   └─ le moteur découvre, décode, agrège, tarife    (src/engine/core/discovery.ts:32)
        └─ le serveur range le résultat dans
           ~/.agent-viz/observatory.db               (observatory/index.ts:17)
              └─ servi en JSON par HTTP
                    └─ les trois pages d'analyse     (src/web/observatory/)
```

Froid, rejoué au démarrage puis toutes les heures (`src/server/server.ts:85` — la
ligne voisine de celle du flux A, même cadence, deux objets différents). **Les
transcripts sont la source de vérité ; la base est un dérivé jetable.** La
supprimer ne perd que les statuts posés à la main sur les recommandations.

---

## 6. Les points d'entrée

Ils se comptent en deux temps, et les confondre fait manquer un hook.

**Ce que le paquet déclare** — `package.json` :

| Entrée | Fichier | Appelée par |
|---|---|---|
| `agent-viz` | `bin/agent-viz.js` | l'utilisateur |
| `netgain` | `dist/engine/cli.js` | l'utilisateur |
| `main` | `dist/server/server.js` | déclaré pour `require('@vcueto/agent-viz')`, qu'aucun code connu n'appelle — mais le fichier lui-même est bien vivant : c'est l'émission du script que le démon lance (`src/server/lifecycle.ts:12`). **Ce qu'il rend a changé à l'étape 3 : voir juste sous cette table.** |
| la page | `index.html` | le navigateur ; importe `./src/web/…` en 10 lignes |

**Le régime de modules de ces points d'entrée a changé à l'étape 3, et un seul
d'entre eux le rend visible de l'extérieur.** `bin/agent-viz.js` et
`dist/server/server.js` sont des ES modules depuis que la racine porte
`"type": "module"` ; lancés par `node`, ils se comportent à l'identique. Mais
`main` est aussi une **surface d'appel** : un projet CommonJS qui écrivait
`require('@vcueto/agent-viz')` ne reçoit plus l'objet `module.exports`, il reçoit
un **espace de noms de module figé** — y affecter une propriété est un no-op
muet en mode non strict, mesuré. C'est la **seule** exception de comportement
observable que l'étape 3 déclare sur le produit, et elle est écrite ici parce
qu'aucun test ne peut l'attraper : rien, dans ce dépôt, n'appelle
`require('@vcueto/agent-viz')`.

**Un test permanent tient les trois premières lignes de cette table**, plus
chaque entrée du champ `files` — `tests/repo/package-entrypoints.test.mjs` : elles
doivent résoudre sur le disque. Il est né à l'étape 3 de la migration, et sa
raison d'être est un fait mesuré : c'était la **seule** surface du produit
qu'aucun instrument ne regardait, ni le typecheck, ni le build, ni les tests, ni
le filet de citations — et **npm ignore en silence une entrée `files`
inexistante**. Ce qu'il ne dit pas : que le point d'entrée *s'exécute*. Résoudre
n'est pas tourner, et c'est pourquoi chaque étape de la migration se termine
encore par `node bin/agent-viz.js --version`, `node dist/engine/cli.js --version`
et `npm pack --dry-run --ignore-scripts`.

**Ce que l'agent invoque tout seul** — un hook, sur un seul binaire :

| Hook | Commande inscrite | Événement |
|---|---|---|
| agent-viz | `node "<abs>/bin/agent-viz.js" hook --source=claude\|copilot` **ou** `npx --yes @vcueto/agent-viz@X.Y.Z hook --source=…` | les événements Claude / Copilot |

Le hook agent-viz a **deux modes**, et la différence compte : si la racine du
paquet est un cache `npx` éphémère, la commande écrite ne contient **aucun
chemin** (`src/server/install-hooks.ts:333-358`). L'installation globale ou
locale produit la forme absolue ; `npx` produit la forme portable.

**`bin/agent-viz.js` n'ayant pas bougé à l'étape 2, le hook agent-viz en mode
`absolute` a survécu au déplacement** — c'est le hook du **moteur** qui a
cassé, et lui seul. Le mécanisme qui le nommait et le réparait (`netgain
status` / `netgain on`) a disparu avec l'étape 6 bis (2026-09, doc/36) : une
configuration écrite avant la fusion et jamais réparée entre-temps reste
orpheline, sans outil pour la retirer — mesuré sans exposition connue au jour
du retrait (doc/36 § 1.4).

Ce que ce dépôt n'établit pas : **sous quelle forme Claude Code ou Copilot CLI
remontent à l'utilisateur l'échec d'un hook** dont la commande ne trouve plus son
fichier. Rien ici ne le teste.

### Le produit écrit chez son utilisateur — en deux endroits de natures différentes

C'est le point le plus rigide du produit, et l'inventaire en est plus large qu'il
n'y paraît.

| Qui écrit | Où | Chemin absolu ? |
|---|---|---|
| `src/server/install-hooks.ts` | **six** destinations possibles selon l'agent et la portée : `~/.claude/settings.json`, `<dépôt>/.claude/settings{,.local}.json`, `~/.copilot/hooks/agent-viz.json`, `<dépôt>/.github/hooks/agent-viz{,.local}.json` | **seulement en mode `absolute`** |
| `src/server/install-hooks.ts` | ajoute une ligne au **`.gitignore` du dépôt de l'utilisateur**, quand il écrit un fichier de portée locale — jamais n'en crée un (l. 361-376) | sans objet |

La deuxième ligne est la plus intrusive des deux : c'est la seule qui touche un
fichier **versionné** de l'utilisateur.

`install-hooks.ts` reconnaît **quatre formes** de sa propre ligne
(l. 144-148) : deux historiques — les deux formes `hook.js` d'avant les
déplacements — et **deux formes courantes**, une par mode. C'est la trace de
déplacements passés : le produit a déjà cassé ses propres installations, et il a
appris à les recoudre plutôt qu'à les dupliquer.

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

**Le nettoyage en tête de `build` a remplacé un geste inverse.**
Jusqu'à l'étape 3, le build **écrivait** un fichier dans `dist/engine/` — le
marqueur `{"type": "module"}` que la racine CommonJS rendait nécessaire — et il
ne nettoyait rien. La racine devenue ESM, ce marqueur n'a plus d'objet ; mais
`tsc` ne vide jamais son `outDir`, si bien que le résidu serait resté sur les
postes qui l'avaient déjà construit, et serait parti dans le tarball **en
silence, `exit=0`** (mesuré). Le `build` efface donc `dist/engine` et
`dist/server` avant de compiler (`package.json`, script `build`). C'est un
**changement de comportement observable**, déclaré comme tel :
`prepare` exécute `build` chez qui installe depuis un dépôt git.

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

**Un seul exécuteur, un seul arbre de tests dans 130 fichiers.**

```
npx vitest run     → tous passés, 130 fichiers
```

Les deux arbres ont fusionné à plat à l'étape 2 : `netgain/tests/` a rejoint
`tests/`, sans une seule collision de nom. Il reste **deux dialectes** dans le
même dossier, et c'est ce qui explique le pont ci-dessous.

| Dialecte | Fichiers | Écrits en |
|---|---|---|
| CommonJS + ESM | 41 `.test.cjs` + 64 `.test.mjs` | `node:test` |
| TypeScript | 25 `.test.ts` | l'API de vitest |

**L'extension dit désormais le régime, et c'est l'étape 3 qui l'a rendue
nécessaire.** Sous une racine `"type": "module"`, un `.js` **est** un module ES :
`require()` n'y existe plus. Les 42 `.test.js` d'avant l'étape 3 ne pouvaient
donc pas survivre à la bascule sous ce nom — et la panne aurait été **partielle**,
donc lisible comme « ça marche presque » : un fichier qui ne requiert que des
modules `node:` continuait de passer. **39** d'entre eux sont devenus `.test.cjs`
par un `git mv` pur ; les **3** derniers manipulaient `require.cache`, un
mécanisme que le régime ESM rend inerte, et ont été réécrits en même temps que
renommés — deux en `.test.mjs`, un en `.test.ts`.

**Les 105 fichiers en `node:test` passent par un pont** (`test-support/bridge/`),
qui rend la surface `node:test` au-dessus des primitives de vitest. **L'addition,
écrite pour qu'on puisse la refaire — et re-dérivée à l'étape 3, où l'ancienne
version se contredisait elle-même** (elle totalisait 74 trois lignes sous un
« 75 » mesuré) **puis au volet 1, où elle s'était de nouveau tue d'une ligne**
(elle totalisait 75 sous un **76** mesuré à la fusion de l'étape 4 : la ligne
manquante est ci-dessous, relevée après coup et non réécrite) :

```
70  préexistaient au pont (v0.12.8) — pas une ligne réécrite
+2  étape 1  node-test-bridge.test.mjs · test-ids-format.test.mjs
+1  étape 2  stale-path-citations.test.mjs        les trois racines mortes
+3  étape 3  package-entrypoints.test.mjs         les points d'entrée déclarés
             install-hooks-entrypoint.test.mjs    les gardes de point d'entrée
             server-imports-load.test.mjs         la résolution, chargée pour de vrai
-1  étape 3  observatory-claude-dir passe à l'API vitest : il QUITTE le pont
±0  étape 2 crée dist-esm-marker.test.mjs, étape 3 le supprime avec son sujet
+1  étape 4  test-file-extensions.test.mjs        l'extension d'un test est un contrat
             (ligne omise en son temps — c'est elle qui laissait l'addition à 75)
+2  volet 1  observatory-rules-r7.test.cjs        la 7e règle de conseil
             verification-commands.test.mjs       le classifieur, sous les DEUX exécuteurs
±0  volet 1  verification.test.ts naît hors du pont : il tenait alors à l'API vitest,
             faute de pouvoir charger les SOURCES du moteur sous `node --test`
――
78
+6  18/08    error-format.test.mjs · errors-register.test.mjs · version-route.test.cjs
             topbar-status.test.mjs · arbitration-view.test.mjs · observatory-service-status.test.cjs
+3  19/08    install-hooks-registry.test.mjs · install-hooks-scan.test.mjs · file-size-budget.test.mjs
+1  20/08    advisor-card.test.mjs
+2  étape 5 (12/09)  served-ts-strip-check.test.mjs · static-ts-route.test.cjs
――
90
+3  étape 6  build-guards.test.mjs · no-local-engine-primitives.test.mjs · served-web-graph.test.mjs
-1  étape 6  engine-require.test.cjs quitte l'arbre avec la primitive qu'il testait (le pont
             part, tâche 3 de l'étape) — comptait pour 1 dans les 40 `.test.cjs` de 778eb67
――
92
+1  étape 6, tâche 6  architecture-test-counts.test.mjs   ce paragraphe tient enfin ses
                      trois comptes au disque, plutôt que de les affirmer
――
93
+2  14/09  bin-help.test.mjs · cli-flags.test.mjs   aide, version et options de la ligne de commande
――
95
-1  14/09  pricing-engine-mirror.test.cjs quitte l'arbre avec la table recopiée qu'il comparait
――
94
+1  14/09  lifecycle.e2e.test.mjs   start, status et stop sur de vrais processus et des ports de test
――
95
+1  15/09  engines-readme-mirror.test.mjs   la plage de Node exigée, identique dans package.json, le lock et le README
――
96
+1  15/09  bind-port.e2e.test.mjs   prise du port : occupé = rien tué et message, libre = écoute
――
97
+1  15/09  relative-specifiers-exist.test.mjs   un import relatif d'un .ts de src/ ou tests/ désigne un fichier qui existe
――
98
+1  15/09  install-hooks-atomic-write.e2e.test.mjs   un fichier de hooks passe par un temporaire, l'ancien survit à une écriture ratée
――
99
+1  15/09  install-hooks-backup.e2e.test.mjs   la copie garde les octets d'avant, les 30 dernières par fichier source
――
100
+1  15/09  install-hooks-backup-registry.e2e.test.mjs   chaque mutation d'un fichier de hooks passe d'abord par sa copie
――
101
+1  15/09  bin-backup-line.test.mjs   le binaire imprime le chemin de la copie sous le fichier changé
――
102
+1  15/09  readme-mirrors.test.mjs   les événements capturés et le nombre de copies gardées, identiques dans le README et le code
――
103
+1  15/09  pricing-drift-alert.test.mjs   l'alerte de la vigie tarifaire : forme complète, hors session, une phrase par nature de dérive
――
104
+1  15/09  alert-shape.test.mjs   la porte d'entrée des alertes dans le navigateur : la forme du détecteur passe, une ligne hors forme est écartée et comptée
――
105
```

```
grep -rlE "(require\(|from )['\"]node:test['\"]" tests | wc -l   → 105
```

Le test du pont a la propriété amusante de passer par ce qu'il teste dès qu'on
l'exécute sous vitest. Le décompte du pont **grandit à chaque fichier `node:test`
neuf, et baisse quand un fichier change de dialecte ou quitte l'arbre** — c'est pour ça qu'il est écrit en
addition plutôt qu'en ordinal, un ordinal ne survivant pas au fichier suivant.
*L'étape 3 en est la démonstration : elle ajoute trois fichiers, en retire un du
pont sans le supprimer, et en supprime un autre — pour un seul fichier de plus au
total (74 à `v0.14.0`, 75 à `v0.15.0`). Un ordinal, ou un total recopié, n'aurait
rien vu.*

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

Le dialecte d'un test ne dépend donc plus de ce qu'il importe, seulement de l'API
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
fuite au lieu de la **constater** — et n'a demandé la réécriture d'aucun test.

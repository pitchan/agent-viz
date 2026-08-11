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
> décompte. « Aucun module de `public/` n'importe `lib/`, et voici le `grep` qui
> rend 0 » vaut mieux que « `public/` contient 28 fichiers ».

Les décomptes qui subsistent portent le commit où ils ont été relevés. Tous ceux
de ce document ont été mesurés le **2026-08-11 sur `894d4dc` (v0.13.0)**, par la
commande citée à côté d'eux. S'ils ont vieilli, la commande le dira ; c'est tout
ce qu'on leur demande.

Un détail de méthode, parce qu'il a mordu pendant la rédaction : les fichiers se
comptent avec `find`, **pas** avec `git ls-files "a/**/*.x"` — cette seconde
forme a sous-compté d'un fichier sur `netgain/tests/`, silencieusement.

---

## 1. Un produit, un paquet, trois unités

agent-viz est **un seul paquet npm**, `@vcueto/agent-viz`, publié depuis un seul
dépôt. Le moteur d'analyse — *netgain* — n'est pas une dépendance : c'est une
partie du produit, dont la source vit dans `netgain/` et dont le build part dans
le même tarball. Un utilisateur qui a le produit a le moteur ; il n'y a rien à
brancher à côté.

Sous ce paquet unique vivent **trois unités**, qui n'ont pas la même raison de
changer, pas le même langage, et pas la même bibliothèque disponible :

| Unité | Ce dont elle est seule responsable | Ce qu'elle ne fait jamais |
|---|---|---|
| **serveur** | capter les crochets, tenir le démon, servir HTTP et SSE, orchestrer les scans, tenir la base dérivée | lire un transcript ligne à ligne, calculer un prix, dessiner |
| **moteur** | lire les transcripts, découvrir les sessions, agréger les jetons, tarifer, appliquer les règles de diagnostic | connaître le démon, connaître une page, ouvrir un socket HTTP entrant |
| **navigateur** | rendre, tenir l'état de page, réagir | toucher au disque, ouvrir un fichier, importer un module `node:` |

Cette table est l'**invariant**. Les répertoires qui la portent aujourd'hui sont
au § 8, et c'est la seule chose qui bouge.

---

## 2. Les trois unités en détail

### 2.1 Le serveur

**53 fichiers**, CommonJS (`"type": "commonjs"` à la racine).

```
lib/            hook.js · install-hooks.js · lifecycle.js · prompt-install.js · server.js
lib/server/               HTTP, SSE, table de routes, tarification d'affichage
lib/server/observatory/   orchestration des scans, base, provenance
lib/server/observatory/rules/     les règles de conseil, une par fichier
lib/server/transcript-adapters/   Claude / Copilot, un contrat commun
lib/server/watchdog/              surveillance et alertes
bin/agent-viz.js                  le binaire
```

Sa table de routes est **déclarative** (`lib/server/routes.js:275`) : ajouter une
route est une ligne de données, pas une branche de plus dans un aiguilleur. C'est
le précédent que [CLAUDE.md](./CLAUDE.md) cite pour le principe ouvert/fermé.

### 2.2 Le moteur

**42 fichiers**, TypeScript `strict`, ES modules, compilé par `tsc` vers
`netgain/dist/`.

```
netgain/src/core/       lecture JSONL, découverte de sessions, usage, tarifs
netgain/src/doctor/     les règles de diagnostic, leurs agrégateurs, leur rapport
netgain/src/install/    écriture de la configuration de l'utilisateur
netgain/src/map/        la carte de projet
netgain/src/mcp/        le serveur MCP
netgain/src/router/     l'aiguillage du crochet
netgain/src/cli.ts      le binaire `netgain`
```

`netgain/package.json` ne contient que `{"type": "module"}`. Ce n'est pas un
second paquet : c'est le marqueur qui rend ce sous-arbre ESM à l'intérieur d'une
racine CommonJS. Il doit rester tant que la racine est CommonJS.

### 2.3 Le navigateur

**28 fichiers** — 20 `.js`, 6 `.mjs`, `viz.css`, et le même marqueur
`{"type": "module"}`. ES modules, servis tels quels en HTTP depuis `public/`
(`lib/server/routes.js:91`).

```
public/               viz-state · viz-canvas · viz-layout · viz-ui · viz-network
public/observatory/   les trois vues d'analyse : conseils, sessions, tarifs
                      (trois vues d'un seul document — il n'y a qu'un `.html`)
```

Il ne parle au serveur que par le réseau, et depuis **trois fichiers** :

| Fichier | Ce qu'il ouvre |
|---|---|
| `public/viz-network.js` | le flux SSE `/stream` (l. 87) et les appels du temps réel |
| `public/observatory/api.js` | le client HTTP des trois vues d'analyse |
| `public/viz-watchdog-client.js` | les alertes de surveillance |

Aucun autre module n'ouvre le réseau. **Cette frontière-là piège la mesure trois
fois**, et les trois pièges valent d'être écrits parce qu'ils reviendront à
chaque fois qu'on voudra la contrôler automatiquement :

```
grep -rl "fetch" public/     → 7 fichiers
```

| Les 7 fichiers | Ce qu'ils font réellement |
|---|---|
| `viz-network.js`, `viz-watchdog-client.js` | appellent `fetch` / `EventSource` — les seuls que `grep "fetch("` trouve |
| `observatory/api.js` | reçoit `fetchImpl = fetch` en **paramètre par défaut**, par injection ; `grep "fetch("` le manque |
| `observatory/store.js`, `observatory/advisor-view.js` | appellent des méthodes **nommées** `api.fetchSummary`, `api.fetchAlerts`… sur le client injecté : ils ne sortent pas, ils délèguent |
| `viz-layout.js`, `viz-narrator.js` | ne portent le mot que dans un commentaire, qui dit qu'ils n'en font justement pas |

Trois fichiers sortent, quatre ressemblent à des sortants. Un contrôle de
frontière écrit contre le mot `fetch` se trompe donc dans les deux sens à la
fois.

**Deux** sorties non-réseau existent par ailleurs, et aucune ne contredit la
table du § 1 — ce sont des API du navigateur, pas du disque :
`observatory/failures-view.js:84` (`navigator.clipboard.writeText`) et
`viz-ui.js:565-572`, qui demande la permission puis lève une **notification
système** (`new Notification(...)`). La seconde sort de la page plus visiblement
que la première.

---

## 3. La règle de dépendance

Une phrase, et c'est le seul invariant structurel du produit :

> **Le serveur appelle le moteur. Le navigateur ne parle qu'HTTP. Le moteur
> ignore les deux autres.**

Un sens unique, jamais de retour. Trois commandes l'établissent, et **chacune
vient avec son contrôle négatif** — parce qu'une commande dont la sortie vide est
la preuve doit d'abord prouver qu'elle *sait* ne pas être vide :

```sh
# 1. Le moteur n'atteint pas le produit.
grep -rEn "from ['\"].*(\.\./)+(lib|public)/" netgain/src/            # → vide
echo "import x from '../../lib/server/usage.js'" \
  | grep -En "from ['\"].*(\.\./)+(lib|public)/"                     # → 1 ligne

# 2. Le navigateur n'importe ni le serveur ni le moteur.
grep -rEn "^[[:space:]]*(import|export).*from ['\"](\.\./)*(lib|netgain)/" public/
echo "import { addUsage } from '../netgain/dist/core/usage.js'" \
  | grep -En "^[[:space:]]*(import|export).*from ['\"](\.\./)*(lib|netgain)/"

# 3. Le navigateur n'importe aucune API Node.
grep -rEn "^[[:space:]]*import .* from ['\"]node:" public/           # → vide
echo "import fs from 'node:fs'" \
  | grep -En "^[[:space:]]*import .* from ['\"]node:"                # → 1 ligne
```

**Pourquoi les contrôles négatifs sont écrits là plutôt que sous-entendus.** La
première rédaction de cette section portait un motif `(lib\|netgain)` sous
`grep -E`, où `\|` n'est pas une alternation mais un **tube littéral** : la
commande cherchait la chaîne `lib|netgain`, ne pouvait rien trouver, et sa sortie
vide se lisait comme une preuve. Le fait affirmé était vrai — mais par accident,
et la commande censée l'établir était incapable d'échouer.

**Le troisième cas mérite en plus son paragraphe, parce qu'un contrôle naïf se
trompe dans l'autre sens.** `grep -rn "node:" public/` rend **une** ligne,
`viz-invocation-patterns.mjs:193`, et ce n'est **pas** un import : c'est une
expression régulière qui reconnaît `node:internal/` dans le texte d'une trace
d'erreur affichée à l'écran. Un contrôle qui chercherait la chaîne `node:` le
signalerait à tort, et serait désactivé au premier faux positif. Le contrôle
juste porte sur les **instructions d'import**, pas sur le texte des fichiers.

**Aujourd'hui, rien ne tient cette règle mécaniquement.** Elle est vraie parce
qu'elle a été mesurée, pas parce qu'un outil la refuserait. Il n'existe aucune
configuration de lint dans ce dépôt. C'est un manque connu, et le § 10 dit ce
qui le comblera.

---

## 4. Les traversées de frontière, mesurées

Le serveur et le moteur n'ont pas le même régime de modules : CommonJS d'un
côté, ES modules de l'autre, dans un seul paquet. **Chaque appel du serveur vers
le moteur paie donc un droit de passage**, et ce droit est écrit quelque part.
Il l'est en **six fichiers**, par **deux mécanismes distincts**.

### 4.1 Par `require` synchrone — 5 fichiers, 170 lignes

```
grep -rln "engine-require\|requireEngineModule" lib
```

Les deux motifs sont nécessaires, et c'est une leçon plutôt qu'un détail :
chercher le seul nom de fichier rend les quatre **consommateurs** et manque la
**primitive**, qui ne se nomme pas elle-même. Un inventaire de frontière écrit
contre le premier motif serait faux d'un fichier sans avoir l'air incomplet.

| Fichier | Lignes | Rôle |
|---|---|---|
| `lib/server/engine-require.js` | 65 | **la primitive** : calcule `netgain/dist`, charge, et nomme deux pannes distinctes — *build manquant* et *build périmé* |
| `lib/server/pricing-engine.js` | 39 | ré-export : `computeCost`, `normalizeModel`, `pricingKindOf` |
| `lib/server/usage.js` | 25 | ré-export : `addUsage`, `emptyUsageBucket`, `finiteCount`, `isDedupableMsgId`, `sumUsageInto` |
| `lib/server/claude-dir.js` | 22 | ré-export : `resolveClaudeDir`, `resolveClaudeJsonPath`, `CLAUDE_DIR_ENV` |
| `lib/server/jsonl.js` | 19 | ré-export : `decodeJsonlLine` |

Les quatre modules de ré-export sortent 12 noms du moteur, mais n'en déclarent
que **11** au contrôle de la primitive. C'est une approximation manuelle d'un
contrôle de types : si le moteur renomme une de ces 11 fonctions, c'est cette
liste écrite en dur qui lève, et non le compilateur.

**Le douzième nom est le trou, et il est structurel.** `claude-dir.js:19-20`
ré-exporte `CLAUDE_DIR_ENV` sans le faire vérifier, et il ne *peut* pas le faire
vérifier : `engine-require.js:54` ne sait contrôler que des fonctions —
`noms.filter(nom => typeof module[nom] !== 'function')`. Or `CLAUDE_DIR_ENV` est
une **chaîne** (`netgain/src/core/claude-dir.ts:9`). L'inscrire dans la liste
ferait lever le contrôle en permanence ; l'en laisser dehors le rend invisible.
Si le moteur le renommait, il deviendrait `undefined` en silence chez tous ses
consommateurs — exactement le mode de panne que la primitive existe pour
supprimer.

### 4.2 Par `import()` dynamique — 1 fichier

`lib/server/observatory/engine.js` calcule lui aussi le chemin de `netgain/dist`
(l. 21) et charge le moteur par `import()` (l. 36-37), **sans passer par la
primitive**. Ce n'est pas un ré-export : c'est l'adaptateur qui injecte le moteur
dans l'observatoire, et tout ce qui est en aval le reçoit en paramètre — ce qui
rend les règles testables sans le moteur.

Une conséquence pratique, à connaître avant de vérifier quoi que ce soit sur
cette frontière : **un contrôle qui ne compte que les ré-exports laisse cette
traversée-là invisible.** Les deux mécanismes se vérifient séparément ou pas du
tout.

**Les deux mécanismes n'ont pas non plus la même robustesse**, et l'écart va dans
le sens qu'on n'attend pas. La primitive vérifie ses noms (11 sur 12, § 4.1) et
nomme un build périmé. `observatory/engine.js`, lui, `import()` puis lit **cinq**
exports **directement, sans aucun contrôle** — `core.discoverSessions` (l. 40),
`core.parseSince` (41), `doctor.scanSession` (42), `doctor.netTokens` (43),
`core.priceTable` (47) : un export disparu ne s'y annonce pas, il devient
`undefined` et échoue plus loin.

Un dernier détail sur ce fichier, parce qu'il est vrai et qu'il n'est pas
joli : il déclare `FIXTURE_CLAUDE_DIR` (l. 20), un chemin vers
`tests/fixtures/observatory/`, et l'exporte (l. 65). Du code de production
désigne donc un répertoire que le paquet publié ne contient pas — `tests/` est
hors de `files`. Son seul consommateur est
`tests/unit/observatory-engine-contract.test.js`.

---

## 5. Les deux flux de données

Ils ne partagent ni source, ni durée de vie, ni mode de panne. Les confondre est
la principale façon de se tromper sur ce produit.

### Flux A — la capture temps réel

```
Claude Code / Copilot CLI
   └─ le crochet lance `agent-viz hook`
        ├─ écrit  ${tmpdir}/agent-events/<session>.jsonl     (dossier : hook.js:16
        │                                                     écriture : hook.js:73)
        └─ POST /notify au démon, sans attendre la réponse
              └─ le démon diffuse en SSE sur /stream          (routes.js:281)
                    └─ la page se met à jour                  (viz-network.js:87)
```

Chaud, éphémère, purgé toutes les heures (`lib/server.js:112`). Le crochet
**n'attend jamais** le démon : un démon éteint ne ralentit pas la session de
l'utilisateur.

### Flux B — l'observatoire

```
~/.claude/projects/<projet>/<session>.jsonl        (la source de vérité)
   └─ le moteur découvre, décode, agrège, tarife    (netgain/src/core/discovery.ts:32)
        └─ le serveur range le résultat dans
           ~/.agent-viz/observatory.db               (observatory/index.js:17)
              └─ servi en JSON par HTTP
                    └─ les trois pages d'analyse     (public/observatory/)
```

Froid, rejoué au démarrage puis toutes les heures (`lib/server.js:113` — la
ligne voisine de celle du flux A, même cadence, deux objets différents). **Les
transcripts sont la source de vérité ; la base est un dérivé jetable.** La
supprimer ne perd que les statuts posés à la main sur les recommandations.

---

## 6. Les points d'entrée

Ils se comptent en deux temps, et les confondre fait manquer un crochet.

**Ce que le paquet déclare** — `package.json` :

| Entrée | Fichier | Appelée par |
|---|---|---|
| `agent-viz` | `bin/agent-viz.js` | l'utilisateur |
| `netgain` | `netgain/dist/cli.js` | l'utilisateur |
| `netgain-map` | `netgain/dist/mcp/main.js` | un client MCP |
| `main` | `lib/server.js` | déclaré pour `require('@vcueto/agent-viz')`, qu'aucun code connu n'appelle — mais le fichier lui-même est bien vivant : c'est le script que le démon lance (`lib/lifecycle.js:12`) |
| la page | `index.html` | le navigateur ; importe `./public/…` en 10 lignes |

**Ce que l'agent invoque tout seul** — deux crochets, sur deux binaires
différents, et c'est la partie qu'on oublie :

| Crochet | Commande inscrite | Événement |
|---|---|---|
| agent-viz | `node "<abs>/bin/agent-viz.js" hook --source=claude\|copilot` **ou** `npx --yes @vcueto/agent-viz@X.Y.Z hook --source=…` | les événements Claude / Copilot |
| moteur | `node "<abs>/netgain/dist/cli.js" router-hook` | `UserPromptSubmit` |

Le crochet agent-viz a **deux modes**, et la différence compte : si la racine du
paquet est un cache `npx` éphémère, la commande écrite ne contient **aucun
chemin** (`lib/install-hooks.js:244-256`). L'installation globale ou locale
produit la forme absolue ; `npx` produit la forme portable.

### Le produit écrit chez son utilisateur — en trois endroits de natures différentes

C'est le point le plus rigide du produit, et l'inventaire en est plus large qu'il
n'y paraît.

| Qui écrit | Où | Chemin absolu ? |
|---|---|---|
| `lib/install-hooks.js` | **six** destinations possibles selon l'agent et la portée : `~/.claude/settings.json`, `<dépôt>/.claude/settings{,.local}.json`, `~/.copilot/hooks/agent-viz.json`, `<dépôt>/.github/hooks/agent-viz{,.local}.json` | **seulement en mode `absolute`** |
| `netgain/src/install/` | `~/.claude.json` (le serveur MCP) et `<dépôt>/.claude/settings.local.json` (le crochet routeur) | **toujours** |
| `lib/install-hooks.js` | ajoute une ligne au **`.gitignore` du dépôt de l'utilisateur**, quand il écrit un fichier de portée locale — jamais n'en crée un (l. 259-270) | sans objet |

La troisième ligne est la plus intrusive des trois : c'est la seule qui touche un
fichier **versionné** de l'utilisateur.

`install-hooks.js` reconnaît **quatre formes** de sa propre ligne
(l. 66-70) : deux historiques — les deux formes `hook.js` d'avant les
déplacements — et **deux formes courantes**, une par mode. C'est la trace de
déplacements passés : le produit a déjà cassé ses propres installations, et il a
appris à les recoudre plutôt qu'à les dupliquer.

---

## 7. Ce qui est source, ce qui est dérivé

Aucun de ces trois artefacts n'est une source de vérité. Aucun n'est versionné.
Les supprimer est toujours sans danger.

| Artefact | Produit par | Reconstruit par |
|---|---|---|
| `netgain/dist/` | `npm run build` (`tsc`) | `npm run build` |
| `~/.agent-viz/observatory.db` | les scans | le scan suivant |
| `${tmpdir}/agent-events/*.jsonl` | le crochet | la session suivante |

Corollaire pour qui développe : **après avoir modifié le moteur, il faut
reconstruire.** Le serveur charge `netgain/dist/`, pas la source. C'est
exactement le mode de panne que `engine-require.js` nomme *build périmé* — et
c'est pour ne pas avoir à le deviner qu'il porte deux messages distincts.

---

## 8. Adresses

**C'est la seule section de ce document qu'un déplacement de fichiers réécrit.**
Tout le reste est écrit en termes de responsabilités, qui ne bougent pas.

| Unité | Répertoires, au 2026-08-11 (`894d4dc`) | Fichiers |
|---|---|---|
| serveur | `lib/` + `bin/` | 52 + 1 |
| moteur | `netgain/src/` → `netgain/dist/` | 42 |
| navigateur | `public/` | 28 |

---

## 9. La plomberie de test

**Un seul exécuteur, deux arbres de tests, 1 338 tests dans 113 fichiers.**

```
npx vitest run     → 1338 passés, 113 fichiers
```

| Arbre | Fichiers | Écrits en |
|---|---|---|
| `tests/` | 42 `.test.js` + 30 `.test.mjs` | `node:test` |
| `netgain/tests/` | 41 `.test.ts` | l'API de vitest |

**Les 72 fichiers de `tests/` passent par un pont** (`test-support/bridge/`), qui
rend la surface `node:test` au-dessus des primitives de vitest. Les 71 qui
préexistaient au pont n'ont pas été réécrits — pas une ligne. Le soixante-douzième
est le test du pont lui-même, écrit avec lui, et il a la propriété amusante de
passer par ce qu'il teste dès qu'on l'exécute sous vitest.

Le pont est en trois fichiers, et sa forme n'est pas un choix esthétique — elle
est imposée par le fait qu'**une seule couture ne suffit pas** :

| Fichier | Rôle |
|---|---|
| `create-bridge.mjs` | la **fabrique pure** : reçoit ses primitives par injection, se teste seule, ne connaît ni vitest ni `node:module` |
| `install.mjs` | couture n° 1 : détourne `Module._load` — atteint les `require('node:test')` des **42** fichiers CommonJS |
| `node-test-alias.mjs` | couture n° 2 : cible d'un `resolve.alias` de `vitest.config.mts` — atteint les `import … from 'node:test'` des **30** fichiers ESM |

La seconde ne remplace pas la première, elle s'y ajoute : la résolution ESM ne
passe pas par le crochet CommonJS. Un pont amputé de l'une des deux laisse un
tiers du filet non exécuté **sans le dire** — c'est mesuré, pas supposé.

Le pont **refuse en se nommant** les **15 API** qu'il sait ne pas implémenter
(`NON_IMPLEMENTE_MODULE` et `NON_IMPLEMENTE_CONTEXTE` dans `create-bridge.mjs`) :
`describe`, `it`, `test.skip`, `t.test`… Jamais un no-op. C'est un **inventaire
figé**, relevé sur ce que `tests/` utilisait réellement, et non une garde
générale : il n'y a pas de `Proxy`, donc une API de `node:test` hors de cette
liste vaudrait `undefined` sans se signaler. Étendre le filet, c'est allonger ces
deux listes.

`npm run test:node` exécute les mêmes 836 tests de `tests/` **nativement**, sous
`node --test`. Ce n'est pas une redondance : c'est la **sémantique de référence**
à laquelle le pont est comparé. Si plus rien ne l'exerçait, elle pourrait cesser
de passer sans que rien ne l'annonce. La publication lance les deux.

---

## 10. Ce qui va changer

Les deux régimes de modules d'un même paquet sont un héritage : le produit et le
moteur ont d'abord vécu dans deux dépôts. Leur fusion en un seul paquet est
faite ; la fusion en un seul **arbre** est en cours, vers `src/server/`,
`src/engine/` et `src/web/`, en TypeScript et en ES modules partout.

Trois choses en découlent, et elles sont annoncées ici parce que ce document en
est la référence :

1. **Les responsabilités du § 1 ne changent pas.** Seule la table du § 8 change.
   C'est la raison pour laquelle ce document est écrit ainsi.
2. **Les six traversées du § 4 perdent leur objet.** Un régime de modules unique
   rend l'appel direct : `import { addUsage } from '../engine/core/usage.js'`.
   Les cinq fichiers du § 4.1 disparaissent, et le sixième cesse de calculer un
   chemin de build — que le module survive ensuite comme point de composition est
   une autre question. Les 11 noms écrits à la main deviennent l'affaire du
   compilateur, **et le douzième cesse d'être un angle mort** : `CLAUDE_DIR_ENV`
   étant une chaîne, seul un compilateur peut le vérifier.
3. **La règle du § 3 cessera d'être une simple mesure.** Deux mécanismes s'en
   chargeront, et aucun ne couvre l'autre : le compilateur, qui refusera un
   `import` d'API Node **direct** dans le navigateur en ne lui donnant pas les
   types de Node ; et une règle de lint, qui seule voit le cas **transitif** —
   un module partagé, pur aujourd'hui, qui gagnerait un `node:` demain.

**Les chemins absolus du § 6 sont les seuls points où cette fusion se verra de
l'extérieur**, et ils ne sont pas exposés de la même façon :

- le crochet du **moteur** porte toujours un chemin absolu — il casse à coup sûr ;
- le crochet **agent-viz** ne casse que s'il a été posé en mode `absolute` ; en
  mode `npx`, sa ligne ne nomme aucun chemin et survit au déplacement.

Dans les deux cas où la panne survient, elle est **bruyante** : le crochet
agent-viz échoue en nommant le module introuvable, et le processus MCP sort en
erreur `MODULE_NOT_FOUND`. Ce que ce dépôt n'établit pas, et qu'il ne faut donc
pas promettre, c'est **sous quelle forme le client MCP remonte cet échec à
l'utilisateur** : rien ici ne le teste. La réparation, elle, est une commande.

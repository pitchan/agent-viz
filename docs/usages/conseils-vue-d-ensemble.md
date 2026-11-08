# Voir d'un coup d'œil ce qui mérite l'attention sur la page Conseils

## Pour qui, pour quoi

- **Qui** : la personne qui utilise des agents de code (Claude Code, Codex, Copilot, Antigravity) et ouvre la page *Conseils* d'agent-viz.
- **Son besoin** : savoir en ouvrant la page, sans rien déplier, s'il y a quelque chose à regarder et où, puis passer des pannes aux conseils en un clic.
- **Ce que l'application ne fait jamais** : additionner des coûts venus de blocs différents, ou afficher un chiffre qu'elle ne peut pas établir.

## Vocabulaire

| Mot à l'écran | Ce qu'il veut dire |
|---|---|
| Panne | un appel d'outil qui a mal tourné, de la même façon, une ou plusieurs fois (voir la spec [onglet Pannes](conseils-pannes.md)) |
| Conseil | une carte de la page : un problème observé, son coût et le geste qui le corrige (voir la spec [Répondre à une carte](conseils-repondre-a-une-carte.md)) |
| Conseil revenu | une carte à laquelle on avait répondu *Je l'adopte* ou *Plus tard*, et qui revient parce que son coût a regrossi |
| Phrase-bilan | la phrase en tête de page qui dit ce qui mérite l'attention |
| Onglet | une des deux vues de la page : *Pannes* ou *Conseils* |

## Ce que l'écran montre

```
CONSEILS                      7 j | 30 j | 90 j     Relancer l'analyse
Une panne revient souvent : Même appel répété à l'identique — Shell (Bash) (11 fois).
17 conseils attendent ta réponse.
▸ Détail de la période                               ← replié
┌───────────────────┐ ┌───────────────────┐ ┌───────────────────┐
│ 13                │ │ 17                │ │ 0                 │
│ pannes à traiter  │ │ conseils à traiter│ │ conseils revenus  │
│ · apparues 30 fois│ │                   │ │                   │
└───────────────────┘ └───────────────────┘ └───────────────────┘
  ↑ onglet ouvert : souligné
[contenu de l'onglet ouvert]
```

## Situations d'usage

- **J'ouvre la page** : je lis la phrase-bilan ; je sais s'il y a une panne qui revient souvent et combien de conseils attendent.
- **Je veux voir les conseils** : je clique sur le compteur *conseils à traiter*. L'onglet Conseils s'ouvre.
- **Un conseil est revenu** : le compteur *conseils revenus* n'est pas à zéro ; je clique dessus et j'arrive sur l'onglet Conseils, où la carte revenue est déjà ouverte.
- **Je veux les chiffres de la période** : je déplie *Détail de la période*.

## Règles de gestion

Sources : **vu** (constaté à l'écran), **relevé** (constaté dans le comportement, pas encore vu à l'écran), **voulu** (confirmé par le mainteneur le 20/10/2026), **#N** (écart suivi dans le ticket N).

### La phrase-bilan

| # | Règle | Source |
|---|---|---|
| V1 | La phrase-bilan est en tête de page, sous la période. Elle s'écrit en morceaux, dans l'ordre du tableau ci-dessous. | voulu |
| V2 | « Revient souvent » veut dire : apparue 5 fois ou plus sur la période. S'il y en a plusieurs, la phrase nomme la plus fréquente ; à égalité, la plus récente. | voulu |
| V3 | Si les pannes n'ont pas pu être chargées, la phrase n'en dit rien. | voulu |

| Situation | Morceau de phrase | Source |
|---|---|---|
| une panne à traiter apparue 5 fois ou plus | « Une panne revient souvent : {nom de la panne} — {outil} ({N} fois). » | voulu |
| des pannes à traiter, aucune 5 fois ou plus | « {n} pannes à traiter, aucune ne revient souvent. » (« 1 panne à traiter » au singulier) | voulu |
| aucune panne à traiter | « Aucune panne à traiter sur la période. » | voulu |
| puis, s'il y a des conseils à traiter | « {k} conseils attendent ta réponse. » (« 1 conseil attend ta réponse. ») | voulu |
| puis, s'il y a des conseils revenus | « {r} conseils revenus : le problème a regrossi. » (« 1 conseil revenu : … ») | voulu |
| ni panne, ni conseil, ni conseil revenu | « Aucune recommandation sur la période — rien à corriger. » | voulu |

### Le détail de la période

| # | Règle | Source |
|---|---|---|
| V4 | Les chiffres de la période (sessions, coût équivalent API, jetons, sessions exclues, source des prix) sont sous *Détail de la période*, replié à l'ouverture de la page. | voulu |

### Les compteurs-onglets

| # | Règle | Source |
|---|---|---|
| V5 | Trois compteurs, dans cet ordre : *pannes à traiter*, *conseils à traiter*, *conseils revenus*. | voulu |
| V6 | *Pannes à traiter* compte les pannes dont au moins une apparition n'est pas acquittée. Dessous : « apparues N fois », la somme des apparitions de ces pannes. | voulu |
| V7 | *Conseils à traiter* compte les cartes qui proposent des boutons de réponse, tous blocs confondus. Les cartes *Ne se produit plus* n'y sont pas. C'est un nombre de cartes, jamais une somme de coûts. | voulu |
| V8 | *Conseils revenus* compte les cartes qui portent le bandeau de retour. | voulu |
| V9 | Un clic sur *pannes à traiter* ouvre l'onglet Pannes ; un clic sur *conseils à traiter* ou *conseils revenus* ouvre l'onglet Conseils. Le compteur de l'onglet ouvert est souligné. | voulu |
| V10 | À l'ouverture de la page, l'onglet ouvert est Pannes s'il reste une panne à traiter, sinon Conseils. Il ne change plus tant que la page reste ouverte, sauf par un clic. | voulu |
| V11 | Les compteurs n'apparaissent qu'une fois les pannes et les conseils chargés. Si les pannes n'ont pas pu l'être, leur compteur affiche « — » et « pannes indisponibles ». | voulu |
| V12 | Si l'analyse est indisponible, la page le dit à la place du détail de la période ; il n'y a ni phrase-bilan ni compteurs, et l'onglet Pannes reste visible. | voulu |

## Critères d'acceptation

| # | Étant donné | Quand | Alors |
|---|---|---|---|
| B1 | une panne à traiter apparue 11 fois et 17 conseils | j'ouvre la page | la phrase dit « Une panne revient souvent : … (11 fois). 17 conseils attendent ta réponse. » |
| B2 | 13 pannes à traiter, la plus fréquente apparue 4 fois | j'ouvre la page | la phrase commence par « 13 pannes à traiter, aucune ne revient souvent. » |
| B3 | au moins une panne à traiter | j'ouvre la page | l'onglet Pannes est ouvert et son compteur est souligné |
| B4 | aucune panne à traiter | j'ouvre la page | l'onglet Conseils est ouvert |
| B5 | l'onglet Pannes est ouvert | je clique *conseils revenus* | l'onglet Conseils s'ouvre |
| B6 | la page ouverte | je regarde sous la phrase-bilan | *Détail de la période* est replié ; déplié, il montre les sessions et le coût équivalent API |
| B7 | des cartes dans les trois blocs | je compte les cartes à boutons | le compteur *conseils à traiter* donne le même nombre |

## Hors de cette spec

- Le contenu de l'onglet Pannes : spec [conseils-pannes.md](conseils-pannes.md).
- Le contenu de l'onglet Conseils et les réponses aux cartes : spec [conseils-repondre-a-une-carte.md](conseils-repondre-a-une-carte.md).
- Le choix de la période et *Relancer l'analyse*.

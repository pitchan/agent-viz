# Repérer et acquitter les pannes dans l'onglet Pannes

## Pour qui, pour quoi

- **Qui** : la personne qui utilise des agents de code et ouvre la page *Conseils* d'agent-viz.
- **Son besoin** : voir quelles pannes reviennent le plus, sur quel outil, retrouver la commande en cause et le réglage qui l'évite, puis dire qu'elle a traité la panne.
- **Ce que l'application ne fait jamais** : corriger la panne à sa place. Elle montre ce qui s'est produit et propose un réglage à copier.

## Vocabulaire

| Mot à l'écran | Ce qu'il veut dire |
|---|---|
| Panne | une même cause d'échec : le même appel répété à l'identique, des échecs à la suite sur un outil, ou un appel mal formé d'un même motif |
| Apparition (épisode) | une fois où la panne s'est produite, dans une session |
| Chiffre de gravité | le gros « 11× » : le nombre d'apparitions de la panne sur la période |
| Acquitter | dire qu'on a vu et traité une panne ; elle quitte la liste des pannes à traiter |
| Remède | le réglage proposé pour éviter la panne, avec un extrait à copier |

## Ce que l'écran montre

```
LES PLUS FRÉQUENTES
  [11×] Même appel répété à l'identique     [3×] Une commande que…     [3×] Échecs à la suite
        Shell (Bash) · dernière le 19/10         PowerShell · …              Shell (Bash) · …
TOUTES LES PANNES, PAR OUTIL
  ▾ [15×] Shell (Bash)                                          Tout acquitter (15)
          3 sortes de pannes · dernière le 19/10
      ▸ [11×] Même appel répété à l'identique                   dernière 19/10 21:48
              Bash · même commande répétée                      ← nom technique, en petit
      ▸ [3×] Échecs à la suite                                   …
  ▸ [4×] Lecture de page web
  ▸ [1×…] Vues une seule fois — 2 outils : …
▸ Déjà acquittées (n)
```

## Situations d'usage

- **Je cherche ce qui revient le plus** : je regarde *Les plus fréquentes*. Un clic sur une panne l'ouvre à sa place dans la liste.
- **Je veux comprendre une panne** : je déplie son outil, puis la panne ; je vois ses apparitions (date, projet, commande) et le remède s'il y en a un, que je copie.
- **J'ai traité une panne** : je clique *Tout acquitter* sur la panne ; elle part sous *Déjà acquittées*.
- **J'ai traité tout un outil** : je clique *Tout acquitter* sur la ligne de l'outil.

## Règles de gestion

Sources : **vu**, **relevé**, **voulu** (confirmé par le mainteneur le 20/10/2026), **#N** — voir le [README](README.md).

### Ce qui compte comme panne

| # | Règle | Source |
|---|---|---|
| P1 | Une panne à traiter a au moins une apparition non acquittée sur la période. Une panne dont toutes les apparitions sont acquittées va sous *Déjà acquittées (n)*, repliée, en bas de l'onglet. | voulu |
| P2 | Les silences (un outil encore en cours depuis longtemps) ne sont pas des pannes : ils ne sont ni affichés ni comptés. | relevé |
| P3 | Sans aucune panne sur la période, l'onglet dit : « Aucune panne sur la période. Ce bloc garde ce qui s'est produit même quand personne ne regardait. » | vu |

### Le chiffre de gravité

| # | Règle | Source |
|---|---|---|
| P4 | Le chiffre d'une panne est le nombre de toutes ses apparitions sur la période, acquittées comprises. Il dit combien de fois elle est apparue, pas ce qui reste à acquitter. | voulu |
| P5 | Le chiffre d'un outil est la somme des chiffres de ses pannes à traiter. | voulu |
| P6 | Couleur du chiffre : rouge à partir de 5, orange de 2 à 4, gris pour 1. Exception : le chiffre du groupe *Vues une seule fois* (la somme de ses pannes) reste gris quel que soit le total, car chaque outil n'y est vu qu'une fois. | voulu |
| P7 | Aucune ligne ne porte de badge « à traiter » : c'est le chiffre qui dit ce qui compte. | voulu |

### Les plus fréquentes

| # | Règle | Source |
|---|---|---|
| P8 | Les 3 pannes à traiter au plus gros chiffre ; à égalité, la plus récente d'abord. Sans panne à traiter, la section n'apparaît pas. | voulu |
| P9 | Chacune montre son chiffre, son nom, son outil et la date de sa dernière apparition. Un clic ouvre son outil et la panne dans la liste, et l'amène à l'écran. | voulu |

### La liste par outil

| # | Règle | Source |
|---|---|---|
| P10 | Un groupe par outil, du plus gros chiffre au plus petit ; à égalité, le plus récent d'abord. Dans un outil, les pannes vont aussi du plus gros chiffre au plus petit. | voulu |
| P11 | La ligne d'un outil montre son chiffre, son nom, « k sortes de pannes · dernière le JJ/MM » et *Tout acquitter (n)*, où n compte les apparitions non acquittées de l'outil. | voulu |
| P12 | Les outils dont le chiffre vaut 1 sont réunis dans un dernier groupe, *Vues une seule fois*, qui nomme ces outils ; chacune de ses pannes nomme aussi son outil. | voulu |
| P13 | Un appel mal formé se range sous le shell que nomme son motif : PowerShell pour une commande ou un paramètre PowerShell, Shell (Bash) pour un chemin, un guillemet ou une syntaxe de shell POSIX — même si l'appel est passé par un autre outil. | voulu |
| P14 | Une panne dépliée montre son remède quand il en existe un (consigne, extrait, *Copier*), puis ses apparitions : date et heure, projet, faits de l'apparition, commande complète. | vu |

### Les noms

| # | Règle | Source |
|---|---|---|
| P15 | Une panne porte un nom lisible, et son nom technique en petit dessous. Le nom lisible ne répète pas l'outil, qui est dit par son groupe. | voulu |

| Panne | Nom lisible | Source |
|---|---|---|
| même appel répété | « Même appel répété à l'identique » | voulu |
| échecs consécutifs | « Échecs à la suite » | voulu |
| appel mal formé | la phrase de son motif, avec une majuscule (« Un guillemet double non fermé — typiquement un chemin Windows terminé par un antislash ») | voulu |

| Outil | Nom lisible | Source |
|---|---|---|
| Bash | Shell (Bash) | voulu |
| WebFetch / WebSearch | Lecture de page web / Recherche web | voulu |
| Read / Edit / Write | Lecture de fichier / Modification de fichier / Écriture de fichier | voulu |
| SendUserFile / SubagentHandback | Envoi de fichier / Retour de sous-agent | voulu |
| outil d'un serveur MCP | « {outil} (serveur {serveur}) » | voulu |
| tout autre outil | son nom tel quel | voulu |

### Acquitter

| # | Règle | Source |
|---|---|---|
| P16 | *Tout acquitter* (sur une panne ou sur un outil) acquitte les apparitions non acquittées, puis la liste se recharge. Le bouton est grisé pendant l'opération. | vu |
| P17 | Si l'acquittement s'interrompt, la liste se recharge et l'onglet dit « Acquittement interrompu : » suivi de la cause ; ce qui précède l'erreur reste acquitté. | relevé |

## Critères d'acceptation

| # | Étant donné | Quand | Alors |
|---|---|---|---|
| C1 | une panne apparue 11 fois, deux à 3 fois | j'ouvre l'onglet | *Les plus fréquentes* montre 11×, puis les deux 3×, la plus récente d'abord |
| C2 | une panne apparue 10 fois, toutes acquittées, puis une fois de plus | j'ouvre l'onglet | elle est à traiter et son chiffre est 11×, en rouge |
| C3 | un appel PowerShell mal formé passé par un autre outil | je regarde la liste | il est sous le groupe PowerShell |
| C4 | deux outils avec une seule apparition chacun | je regarde la liste | ils sont sous *Vues une seule fois*, qui les nomme |
| C5 | un outil avec 9 apparitions non acquittées | je clique son *Tout acquitter* | ses pannes passent sous *Déjà acquittées* |
| C6 | une panne parmi les plus fréquentes | je clique dessus | son outil et la panne s'ouvrent dans la liste |
| C7 | une panne dépliée qui a un remède | je clique *Copier* | l'extrait est copié et l'onglet dit « copié » |

## Hors de cette spec

- La détection des pannes et ce qui en fait une apparition.
- La pastille d'alerte en direct et les notifications du bureau.

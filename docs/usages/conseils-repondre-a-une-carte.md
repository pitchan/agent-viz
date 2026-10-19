# Répondre à une carte de la page Conseils

## Pour qui, pour quoi

- **Qui** : la personne qui utilise des agents de code (Claude Code, Codex, Copilot, Antigravity) et lit la page *Conseils* d'agent-viz.
- **Son besoin** : dire ce qu'elle fait de chaque conseil, pour que la page ne lui montre plus que ce qui reste à traiter, et la prévienne si un problème qu'elle croyait réglé revient.
- **Ce que l'application ne fait jamais** : appliquer un conseil à sa place. Elle mesure et propose ; la personne décide et agit.

## Vocabulaire

| Mot à l'écran | Ce qu'il veut dire |
|---|---|
| Carte | un conseil : un problème observé dans les sessions passées, son coût, et le geste qui le corrige |
| Geste | l'action conseillée, écrite sur la carte (« Terminer par la preuve : … ») |
| Jetons | l'unité dans laquelle un agent est facturé ; le coût d'une carte en découle |
| Chiffré / non chiffré | la carte a un coût en dollars, ou l'application ne peut pas en calculer un |
| Journal | la section *Décisions rendues*, où vont les cartes auxquelles on a répondu |

## Ce que l'écran montre

```
INEFFICACITÉS OBSERVÉES
  Chiffré en jetons mesurés
    [carte] [carte] [carte]            ← les 3 plus importantes
    Autres observations (n)
    [carte] …
  Estimé depuis les octets — à ne pas comparer au bloc ci-dessus
    …
  Non chiffré — le transcript ne permet pas de mettre un prix sur ces conseils
    …
  Ne se produit plus depuis la dernière analyse (n)
    [carte sans bouton] …
▸ Décisions rendues (n)                ← repliée
```

Une carte, de haut en bas :

1. le titre : le problème et le projet concerné ;
2. le degré de certitude et le coût (« Fait mesuré · 20,38 $ — jetons mesurés ») ;
3. la période observée (« constaté du 19/09 au 19/10 ») ;
4. le geste conseillé ;
5. le détail chiffré (sessions concernées, volumes) ;
6. les boutons de réponse, chacun avec une phrase dessous qui dit ce qu'il entraîne.

## Situations d'usage

- **J'applique le conseil** : je clique *Je l'adopte*. La carte part au journal. Si le problème coûte de nouveau nettement plus, elle revient me demander si mon geste a vraiment pris.
- **Pas maintenant** : je clique *Plus tard*. La carte part au journal et revient d'elle-même si le problème s'aggrave.
- **Ce conseil ne me concerne pas** : je clique *Non merci*, j'écris pourquoi, je clique *Consigner*. La carte part au journal avec ma raison et ne revient plus.
- **Je change d'avis** : j'ouvre *Décisions rendues*, je clique *Réactiver* sur la carte. Elle redevient un conseil à traiter.

## Règles de gestion

Chaque règle porte sa source :

- **vu** : constaté à l'écran ;
- **relevé** : constaté dans le comportement de l'application, pas encore vu à l'écran ;
- **voulu** : confirmé par le mainteneur le 19/10/2026 ;
- **#N** : écart avec l'application, suivi dans le ticket N ; la règle décrit le comportement voulu.

### Rangement des cartes

| # | Règle | Source |
|---|---|---|
| R1 | Les cartes sont rangées en trois blocs, toujours dans cet ordre : chiffré en jetons mesurés, estimé depuis les octets, non chiffré. Un bloc vide n'apparaît pas. | vu |
| R2 | La page n'affiche aucun total : les blocs ne se comparent pas entre eux. | vu |
| R3 | Dans un bloc, les cartes vont de la plus importante à la moins importante. L'importance est le coût, réduit quand la certitude est moindre : un fait mesuré compte en entier, une corrélation à 60 %, une hypothèse à 30 %. | relevé |
| R4 | Les 3 premières cartes d'un bloc sont en tête ; les suivantes sont sous *Autres observations (n)*. | vu |
| R5 | Une carte dont le problème n'a pas été revu à la dernière analyse passe sous *Ne se produit plus depuis la dernière analyse (n)*. Elle n'a aucun bouton. | vu |
| R6 | Sans aucune carte, la page dit : « Aucune recommandation sur la période — rien à corriger. » | relevé |

### Les réponses proposées

| # | La carte | Boutons proposés | Source |
|---|---|---|---|
| R7 | chiffrée, avec un geste | *Je l'adopte*, *Plus tard*, *Non merci* | vu |
| R8 | chiffrée, sans geste | *Plus tard*, *Non merci* | relevé |
| R9 | non chiffrée, avec un geste | *Je l'adopte*, *Non merci* — jamais *Plus tard*, puisqu'elle ne pourrait pas revenir (R17) | vu |
| R10 | non chiffrée, sans geste | *Non merci* | relevé |

| # | Règle | Source |
|---|---|---|
| R11 | Une carte sans geste l'écrit à la place du geste : « Aucun geste recommandé : la cause mesurée n'a pas de remède identifié — carte informative. » | vu |
| R12 | Sous chaque bouton, une phrase dit ce qu'il entraîne (voir le tableau ci-dessous). | vu |

| Bouton | Phrase dessous | Source |
|---|---|---|
| *Je l'adopte*, carte chiffrée | « La carte part au journal. Si le coût regrossit malgré tout, elle reviendra te demander si le geste a vraiment pris. » | vu |
| *Je l'adopte*, carte non chiffrée | « La carte part au journal. » | vu |
| *Plus tard*, carte dont le coût est au-dessus de 0 | « Revient d'elle-même si le coût regrossit de moitié. » | vu |
| *Plus tard*, carte dont le coût vaut 0 | « Revient d'elle-même dès qu'un coût apparaît. » | #15 |
| *Non merci* | « Dis pourquoi ; c'est consigné au journal et ne sera plus proposé. » | #17 |

### Après une réponse

| # | Règle | Source |
|---|---|---|
| R13 | *Je l'adopte* et *Plus tard* agissent aussitôt, sans demande de confirmation : la carte quitte la liste et rejoint le journal. | relevé |
| R14 | *Non merci* déplie un champ « Pourquoi ? » et un bouton *Consigner*. Tant que le champ est vide, *Consigner* est grisé. | #16, #17 |
| R15 | *Consigner* envoie la carte au journal avec la raison écrite. La raison n'a pas de longueur imposée. | relevé, #17 |
| R16 | Au moment de la réponse, l'application retient la date et le coût de la carte ce jour-là. Ce coût sert de point de comparaison pour un retour (R17). | relevé |
| R17 | Une carte adoptée ou mise à plus tard revient dans la liste quand son coût atteint une fois et demie le coût retenu (+50 %). Si le coût retenu valait 0, elle revient dès qu'un coût apparaît. Une carte non chiffrée ne revient jamais d'elle-même. | relevé |
| R18 | Une carte refusée (*Non merci*) ne revient jamais d'elle-même. | relevé |
| R19 | Une carte revenue affiche un bandeau au-dessus de ses chiffres, puis repropose ses boutons. Une nouvelle réponse remplace la date et le coût retenus. | relevé |
| R20 | Une nouvelle analyse met à jour les chiffres des cartes, sans jamais annuler une réponse déjà donnée. | relevé |
| R21 | Un projet déplacé ou renommé est un nouveau projet : sa carte réapparaît comme neuve, et l'ancienne réponse reste attachée à l'ancien emplacement. | voulu |
| R22 | Si une réponse ne s'enregistre pas, la carte affiche « Décision non enregistrée : » suivi de la cause, et garde ses boutons pour réessayer. Le reste de la page ne bouge pas. | #18 |

Texte du bandeau d'une carte revenue (R19) :

| Réponse donnée | Bandeau | Source |
|---|---|---|
| *Je l'adopte* | « Adopté le JJ/MM/AAAA — le coût a pourtant regrossi de X % depuis. Le geste a-t-il pris ? » | relevé |
| *Plus tard* | « Mis en veille le JJ/MM/AAAA — le coût a regrossi de X % depuis. » | relevé |
| l'une ou l'autre, coût retenu à 0 | même phrase, sans « de X % » | relevé |

### Le journal *Décisions rendues*

| # | Règle | Source |
|---|---|---|
| R23 | Le journal est la dernière section de la page. Il est replié ; son titre donne le nombre de cartes : « Décisions rendues (n) ». Sans aucune réponse donnée, il n'apparaît pas. | vu |
| R24 | Il contient les cartes adoptées, mises à plus tard et refusées, les plus récentes en haut. Une carte y reste même quand son problème ne se produit plus. | vu, relevé |
| R25 | Chaque ligne montre le titre de la carte, la réponse et sa date, puis une fin qui dépend de la réponse (tableau ci-dessous), et un bouton *Réactiver*. | vu |
| R26 | *Réactiver* remet la carte comme neuve et efface la raison du refus. Elle retourne dans la liste, ou sous *Ne se produit plus* si son problème a disparu. | relevé |
| R27 | *Purger la base* efface aussi toutes les réponses et leurs raisons, après une seconde confirmation (« Confirmer la purge ? »). Elles ne se récupèrent pas. | voulu |

| Réponse | Début de ligne | Fin de ligne | Source |
|---|---|---|---|
| *Non merci* | « Refusé le JJ/MM/AAAA » | la raison écrite | vu |
| *Je l'adopte*, carte chiffrée | « Adopté le JJ/MM/AAAA » | « reviendra si le coût regrossit malgré tout » | relevé |
| *Plus tard*, coût retenu au-dessus de 0 | « Mis en veille le JJ/MM/AAAA » | « reviendra si le coût regrossit de moitié » | relevé |
| *Plus tard*, coût retenu à 0 | « Mis en veille le JJ/MM/AAAA » | « reviendra dès qu'un coût apparaît » | #15 |
| *Je l'adopte*, carte non chiffrée | « Adopté le JJ/MM/AAAA » | rien | relevé |

## Critères d'acceptation

Chaque critère se vérifie à l'écran, sur la page *Conseils*.

| # | Étant donné | Quand | Alors |
|---|---|---|---|
| A1 | une carte chiffrée avec un geste | j'ouvre la page | je vois *Je l'adopte*, *Plus tard* et *Non merci*, chacun avec sa phrase dessous |
| A2 | une carte non chiffrée | j'ouvre la page | je ne vois jamais *Plus tard* sur cette carte |
| A3 | une carte sous *Ne se produit plus* | j'ouvre la page | elle n'a aucun bouton |
| A4 | une carte active | je clique *Je l'adopte* | elle quitte la liste sans confirmation ; *Décisions rendues* compte une carte de plus ; la ligne dit « Adopté le » + la date du jour |
| A5 | une carte active | je clique *Plus tard* | même chose avec « Mis en veille le » |
| A6 | une carte active | je clique *Non merci* | un champ « Pourquoi ? » et *Consigner*, grisé, apparaissent |
| A7 | le champ « Pourquoi ? » ne contient que des espaces | je regarde *Consigner* | il est toujours grisé |
| A8 | j'ai écrit une raison | je clique *Consigner* | la carte rejoint le journal ; la ligne dit « Refusé le » + la date + ma raison |
| A9 | une carte refusée | de nouvelles analyses montrent que son coût augmente | elle reste dans le journal |
| A10 | une carte mise à plus tard | son coût atteint une fois et demie le coût retenu | elle revient dans la liste avec le bandeau « Mis en veille le … — le coût a regrossi de X % depuis. » |
| A11 | une carte dans le journal | je clique *Réactiver* | elle revient dans la liste comme neuve ; plus aucune raison n'y est attachée |
| A12 | l'enregistrement d'une réponse échoue | je clique un bouton de réponse | la carte affiche « Décision non enregistrée : … » et garde ses boutons ; le reste de la page est intact |
| A13 | des réponses dans le journal | je purge la base et je confirme | le journal disparaît ; les cartes redeviennent neuves après la nouvelle analyse |

## Hors de cette spec

- La liste *Pannes détectées* en haut de la page.
- Le calcul des chiffres d'une carte et le choix de la période (7, 30 ou 90 jours).
- Ce que devient une raison en cours d'écriture quand une analyse se termine (jugé sans importance le 19/10/2026).

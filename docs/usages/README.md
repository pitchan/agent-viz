# Specs fonctionnelles d'agent-viz

Une spec par usage : ce que la personne veut faire, ce que l'écran montre, les règles de gestion et les critères d'acceptation vérifiables à l'écran. Aucune technique. La spec fait foi : si l'application fait autre chose, c'est le code qui change.

## Usages décrits

| Page | Usage | Spec |
|---|---|---|
| Conseils | Répondre à une carte | [conseils-repondre-a-une-carte.md](conseils-repondre-a-une-carte.md) |

## Gabarit

1. **Pour qui, pour quoi** : la personne, son besoin, ce que l'application ne fait pas à sa place.
2. **Vocabulaire** : les mots de l'écran, expliqués.
3. **Ce que l'écran montre** : un schéma de la page, le contenu d'un élément.
4. **Situations d'usage** : « je veux…, je fais…, j'obtiens… ».
5. **Règles de gestion** : numérotées, chacune avec sa source :
   - **vu** : constaté à l'écran ;
   - **relevé** : constaté dans le comportement de l'application, pas encore vu à l'écran ;
   - **voulu** : confirmé par le mainteneur ;
   - **#N** : écart avec l'application, suivi dans le ticket N ; la règle décrit le comportement voulu.
6. **Critères d'acceptation** : « étant donné / quand / alors », vérifiables à l'écran.
7. **Hors de cette spec** : ce qui est volontairement laissé de côté.

## Construire une nouvelle spec

1. Relever l'application telle qu'elle est : l'écran d'abord, le comportement après un clic ensuite.
2. Entretien avec le mainteneur sur les écarts : pour chacun, voulu, à changer (un ticket) ou hors spec ; finir par « qu'est-ce qui manque ? ».
3. Rédiger avec ce gabarit, faire relire.

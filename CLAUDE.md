# CLAUDE.md — agent-viz

## Règle absolue : respect des principes SOLID de manière pragmatique pas de suringenierie

Toute contribution (nouveau code, refactor, correction de bug) **doit** respecter les cinq principes SOLID. Ce n'est pas négociable et passe avant les habitudes de style ou le confort de rapidité.

Quand un changement enfreint un de ces principes, soit tu refactores autour, soit tu **expliques explicitement** pourquoi l'écart est justifié dans le commit / la PR. Pas de dérive silencieuse.

### S — Single Responsibility Principle
Un module, une classe, une fonction = **une seule raison de changer**.
- Ne mélange pas I/O réseau, parsing, et règles métier dans la même fonction.
- Si tu décris ce que fait une fonction et que tu utilises "et" plus d'une fois, elle est probablement à scinder.
- Concrètement dans ce repo : un fichier de `lib/server/routes.js` ne fait pas de logique métier ; un hook ne fait pas de routing ; le parsing d'événements ne fait pas d'I/O fichier.

### O — Open/Closed Principle
Ouvert à l'extension, fermé à la modification.
- Pour ajouter un nouveau type d'événement, une nouvelle source d'agent (Claude / Copilot / autre), un nouveau format de hook → préfère une **table déclarative** ou un **registre/dispatch** à un nouveau `if/else` qui pousse la fonction existante vers la dette.
- Un précédent existe déjà dans le repo : `lib/server/routes.js` table déclarative — réutilise ce pattern.

### L — Liskov Substitution Principle
Les sous-types doivent rester substituables à leur type parent **sans surprise comportementale**.
- En JS sans héritage de classe, ça se traduit par : si plusieurs implémentations partagent un contrat (ex. plusieurs adapters d'agent), elles doivent honorer **strictement** la même signature et les mêmes invariants (mêmes erreurs, mêmes effets de bord, même contrat de retour).
- Pas de "cette implémentation throw, l'autre retourne null" pour le même cas.

### I — Interface Segregation Principle
Pas d'interface fourre-tout. Un consommateur ne doit pas dépendre de méthodes / champs qu'il n'utilise pas.
- Préfère **plusieurs petits objets / modules ciblés** à un gros objet de config qui sait tout faire.
- Pour les fonctions : les paramètres optionnels doivent être réellement optionnels et orthogonaux ; sinon, scinde la fonction.

### D — Dependency Inversion Principle
Les modules de haut niveau ne dépendent pas des modules de bas niveau ; les deux dépendent d'abstractions.
- N'importe pas directement `fs`, `http`, ou un client réseau dans la logique métier — passe-le en paramètre / via injection.
- Cela rend le code testable sans monkey-patching et permet de remplacer le transport (fichier vs. mémoire vs. SSE) sans toucher la logique.

## Garde-fous opérationnels

- **Avant d'ajouter une dépendance, un fichier, ou une couche d'abstraction**, vérifie qu'aucun pattern existant ne couvre déjà le besoin (lis `lib/server/` avant de créer un nouveau module).
- **Pas d'abstraction prématurée** : SOLID ≠ sur-ingénierie. Trois lignes dupliquées peuvent rester dupliquées tant qu'elles n'ont pas une vraie raison commune de changer. La règle SRP s'applique au moment où une *deuxième raison de changer* apparaît, pas avant.
- **Pas de fallback silencieux** ni d'`error handling` défensif pour des cas qui ne peuvent pas arriver (cf. consigne globale du repo).
- Quand un refactor SOLID dépasse le scope du ticket en cours, **ouvre une note / TODO** — n'élargis pas une PR de bugfix en chantier de redesign sans validation explicite.

## En cas de doute

Pose la question avant d'implémenter. Une violation de SOLID introduite "pour aller vite" coûte toujours plus cher à retirer ensuite.

# Tests — AAA et résistance au changement

Ces règles s'appliquent aux fichiers de `tests/`. Elles s'ajoutent au `CLAUDE.md` racine, elles ne le remplacent pas.

Outillage imposé : l'API native de vitest (`describe`/`test`/`expect`, `vi.spyOn`, `vi.useFakeTimers`) — un seul exécuteur, `npm test` (vitest, extension `.test.ts` seule). Chaque test vit dans le sous-dossier de son domaine : `tests/unit/` pour l'unitaire pur, `tests/repo/` pour l'hygiène du dépôt, `tests/e2e/` pour l'intégration, `tests/doctor/`, etc. Pas de nouvelle dépendance de test.

**Seule l'extension `.test.ts` est lue.** Toute autre extension sous `tests/` ne tournerait jamais, et sa présence se lirait comme une couverture. Le filet `tests/repo/test-file-extensions.test.ts` rougit si une telle extension apparaît sous `tests/`. Un import relatif s'écrit en `.ts` (`'../../src/engine/core/usage.ts'`), jamais en `.js` : vitest résout `.js` vers la source, Node ne le fait pas. Filet : `tests/repo/relative-specifiers-exist.test.ts`.

## 1. Structure : AAA, sans exception

Chaque test = trois blocs, dans cet ordre, marqués `// Arrange`, `// Act`, `// Assert`.

**Un seul Act par test.** Deux appels à vérifier = deux tests. Une assertion glissée avant l'Act = le test ment sur ce qu'il prouve.

Seule forme compacte tolérée : la vérification d'une fonction pure sans préparation, où Arrange est vide et Act/Assert tiennent sur la même ligne (`assert.equal(scoreOf(rec(1)), 10)`). Dès qu'il y a un `const` à préparer, les trois commentaires reviennent.

**Pas de `describe` décoratif — un fichier = une facette testée.** Le chemin du fichier groupe déjà : le rapport comme l'échec affichent `tests/unit/observatory-ranking.test.ts > nom du test`. Un `describe('scoreOf')` redit ce que `ranking.test.ts` dit, et nomme la fonction là où le § 2 demande le comportement. Un fichier qui couvre deux facettes se scinde en deux fichiers ; il ne se subdivise pas en deux `describe`.

Deuxième raison, celle qui se voit à la scission : **un `describe` cadre les `const` de son groupe, et masque ainsi qu'ils sont dupliqués d'un groupe à l'autre**. Une fois les groupes mis en fichiers, le doublon devient une redéclaration que le transpileur nomme, et la fabrique partagée par plusieurs facettes se voit — elle part dans `tests/helpers/`.

**Ce n'est pas une optimisation.** Mesuré sur `tests/core` + `tests/doctor` : 23 fichiers en 0,87 s, les mêmes tests en 56 fichiers en 1,63 s. Vitest parallélise bien par fichier, mais le démarrage d'un worker coûte plus que le parallélisme ne rapporte quand un test dure quelques millisecondes. On scinde pour la portée et la lisibilité, jamais pour le temps.

Seul emploi admis de `describe` : cadrer un `beforeEach`/`afterEach` qui ne vaut que pour **une partie** du fichier. Un hook qui vaut pour tout le fichier se pose au niveau du fichier, sans enveloppe. Un `describe` qui ne contient aucun hook n'a pas de raison d'être. Filet : `tests/repo/no-decorative-describe.test.ts` rougit sur tout `describe` dont le bloc ne pose pas directement un hook.

## 2. Résistance au changement

Un test ne doit casser que si **le comportement** change. S'il casse sur un refactor qui n'a rien changé pour l'appelant, c'est le test qui est en tort.

- **Teste le contrat public**, jamais les internes. Pas de test sur une fonction non exportée, un champ privé, ou l'ordre des étapes internes.
- **Assertions ciblées.** Vérifie les champs que le test concerne, pas l'objet entier. Un `deepEqual` sur une grosse structure casse dès qu'on ajoute un champ sans rapport. Exception : quand la forme exacte *est* le contrat (payload d'API, format de sortie figé) — alors le `deepEqual` complet est le bon outil.
- **Fixtures par fabrique + overrides**, comme `rec()` dans `unit/observatory-ranking.test.ts` : un défaut valide, chaque test ne déclare que ce qui diffère. Un nouveau champ obligatoire = une ligne à changer, pas quarante.
- **Nomme le comportement, pas la fonction.** `'un ignoré ne revient qu'au-delà de +50 %'` survit à un renommage ; `'test scoreOf'` devient faux.
- **Ne teste pas les mocks.** N'assère pas « appelé 1 fois avec tel argument » sauf quand cet appel *est* le comportement observable (écriture disque, requête réseau).

## 3. Déterminisme

- **Injecte** l'horloge, `fs`, le réseau, l'aléatoire — ne les monkey-patch pas. Si un module les importe en dur, c'est le module qu'il faut corriger (cf. règle D du `CLAUDE.md` racine).
- Pas de `sleep`, pas de `Date.now()` implicite, pas d'ordre de `Map`/`Object.keys` supposé, pas de dépendance au fuseau : construis les dates comme `unit/alert-format.test.ts` le fait.
- **Zéro état partagé entre tests.** Pas de variable mutée au niveau module, pas de test qui dépend d'un précédent. Chaque test doit passer seul et dans n'importe quel ordre.

## 4. Ce qui n'est pas un test unitaire ici

Rendu DOM, serveur démarré, processus lancé, vrai réseau. Ça relève d'un test d'intégration, rangé dans `tests/e2e/` (suffixe `.e2e.test.*`), pas dans `tests/unit/`.

Le disque fait exception : un dossier temporaire que le test **crée et supprime lui-même** reste dans `tests/unit/`. Il ne rend pas le test moins déterministe, et l'interdire vidait le dossier sans rien y gagner. Ce qui reste interdit, c'est d'écrire ailleurs que dans ce dossier — jamais dans `~/.claude`, `~/.copilot`, `~/.agent-viz`, ni dans le dépôt.

# netgain

> Mesurer **net**, jamais brut. Distribution factuelle des jetons de vos sessions d'agents —
> local, lecture seule, zéro compteur « économisé ».

Moteur d'analyse de l'Observatoire d'[agent-viz](https://github.com/pitchan/agent-viz).
**Ce n'est pas un paquet séparé** : c'est un dossier d'agent-viz, livré et versionné avec lui.
Il lit les transcripts Claude Code de votre poste (`~/.claude/projects/**.jsonl`) et répond à
une seule question, avec des faits : **où partent vos jetons ?**

## Installation

```bash
npm install -g @vcueto/agent-viz
```

Il n'y a rien d'autre à installer : la commande `netgain` ci-dessous est
posée par agent-viz, en même temps que l'interface web.

## Usage

```bash
netgain doctor                       # rapport terminal sur tout ~/.claude
netgain doctor --last 10             # les 10 sessions les plus récentes
netgain doctor --project mon-repo    # projets dont le nom contient « mon-repo »
netgain doctor --since 7d            # sessions de moins de 7 jours
netgain doctor --json > rapport.json # rapport JSON complet (clés triées, diffable)
netgain doctor --list                # lister projets/sessions sans scanner
netgain doctor --claude-dir <dir>    # autre racine (défaut ~/.claude)
```

## Ce que `doctor` mesure — des faits, jamais un gain projeté

1. **Jetons et coût par session** — agent principal et sous-agents, par modèle, décomposés en
   entrée / sortie / création de cache / lecture de cache. La métrique nette est
   entrée + création de cache + sortie : la lecture de cache est exclue parce qu'elle est
   relue à chaque tour et croît mécaniquement avec la longueur de la session. Le coût est
   calculé au tarif du modèle réel de chaque message, à la date du message ; **un modèle sans
   tarif connu donne un coût marqué « partiel », jamais un zéro silencieux**.
2. **Distribution des sorties d'outils** — par outil, par tranche de taille
   (< 2 Ko / 2–30 Ko / > 30 Ko), répétitivité par famille de commande, formats reconnus
   (vitest, jest, tsc, eslint, git, npm, pytest…) et **candidats au filtrage** : les sorties
   répétées, volumineuses et non reconnues.
3. **Sous-agents** — nombre de lancements, types, jetons comptés séparément.
4. **Contexte et reconstruction de cache** — re-créations de cache après le premier tour (le
   symptôme « préfixe invalidé, re-facturé »), croissance du contexte par tour, compactions.
5. **Forme des questions posées** — détecteur déterministe (français et anglais) des questions
   de cartographie de dépôt.

## Garanties d'honnêteté

- **Local** — aucun appel réseau, table de tarifs embarquée dans le paquet.
- **Lecture seule** — les transcripts ne sont jamais modifiés, rien n'est écrit dans les
  dépôts analysés.
- **Jamais de « économisé »** — une session vécue n'a pas de contrefactuel. `doctor` rapporte
  des octets, des jetons et des comptes ; pas des économies imaginaires.
- **Casser bruyamment** — lignes illisibles, types d'événements inconnus, modèles sans tarif
  et sessions ignorées sont toujours visibles dans le rapport.

## Développement

Le moteur vit dans le dépôt [agent-viz](https://github.com/pitchan/agent-viz), dossier
`src/engine/`. Son outillage (TypeScript, vitest) est déclaré à la racine : il n'y a qu'un seul
`npm install` et qu'un seul `package.json` de plein droit. La racine du dépôt porte
`{"type":"module"}` : `src/engine/` est déjà lu comme des modules ES, sans marqueur de
sous-dossier à maintenir ni à écrire par le build.

```bash
git clone https://github.com/pitchan/agent-viz.git
cd agent-viz
npm install
npm run build            # tsc → dist/engine/
npm test                 # un seul `vitest run`, moteur et produit ensemble
```

## Limites connues

1. Sessions anciennes (Claude Code ≤ 2.1.81) : les sous-agents en ligne ne sont pas agrégés —
   ils apparaissent dans « types non exploités », visibles, jamais comptés en silence.
2. Sessions reprises : un éventuel double comptage entre fichiers au niveau projet n'est pas
   dédupliqué (la déduplication par identifiant de message est interne à une session).
3. Un modèle absent de la table de tarifs voit ses jetons comptés et son coût marqué
   « partiel » — une ligne à ajouter dans `src/engine/core/pricing.ts` quand le tarif est publié.

## Licence

MIT — voir [LICENSE](./LICENSE).

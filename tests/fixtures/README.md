# Relevés de charges utiles

Ces fichiers sont des **relevés réels**, capturés sur une machine de développement,
et non des objets écrits à la main. C'est ce qui fait leur valeur : ils figent la
forme que le harnais émet vraiment, y compris là où elle contredit la
documentation. Un test qui les charge tombe si cette forme change.

## `post-tool-use-failure.json`

Charge utile d'un événement `PostToolUseFailure`, relevée le 2026-08-07 par la
sonde de la tâche 1 (une commande volontairement en échec : `exit 3` après un
écrit sur `stderr`).

Ce qu'elle a établi, contre la documentation disponible :

- **`error` est une chaîne plate**, pas un objet structuré : le code de sortie et
  le `stderr` collés par un `\n` (`"Exit code 3\nsonde-echec"`).
- **`is_interrupt` n'est documenté nulle part.** Il vaut `true` quand l'humain a
  appuyé sur Échap — un appel qui s'arrête sans rien apprendre sur la commande.
- **`duration_ms`** donne la durée de l'appel.

### Valeurs neutralisées

Le relevé d'origine portait des identifiants et des chemins de la machine de
capture. Cinq champs — et **seulement** ces cinq — ont été remplacés par des
valeurs neutres, cohérentes entre elles (`transcript_path` dérive bien du
`cwd` et du `session_id`) :

| champ | remplacé |
|---|---|
| `session_id` | UUID nul |
| `prompt_id` | UUID nul |
| `tool_use_id` | même préfixe et même longueur que l'original |
| `transcript_path` | chemin neutre, cohérent avec `cwd` et `session_id` |
| `cwd` | projet neutre |

**Tout le reste est le relevé tel quel** : `hook_event_name`, `tool_name`,
`tool_input`, `error` (au caractère près), `is_interrupt`, `duration_ms`,
`permission_mode`, `effort`, `_ts`, `_source`, ainsi que le nombre et l'ordre
des champs. C'est cela, le contrat — ne pas le « nettoyer ».

Lecteur : `tests/unit/watchdog-loop-outcomes.test.mjs`.

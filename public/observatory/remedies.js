// remedies.js — le remede pret a l'emploi de chaque motif alertant, en un seul
// endroit.
//
// Contrat (doc/32) : chaque motif alertant (`workstationSetting: true` dans
// public/viz-invocation-patterns.mjs) a une entree EXPLICITE ici. `null` est une
// reponse : « aucun remede honnete » — le filet en est l'exemple oblige, sa
// cause n'etant pas caracterisee (doc/30). Un motif absent de la table est un
// oubli, et le test le dit. Jamais de conseil invente.
//
// Module pur : ni DOM, ni reseau, ni import — une table et une fonction.

const CLAUDE_MD = titre => `## ${titre}\n`;

export const REMEDES = {
  'inv-bash-windows-path-unquoted': {
    consigne: 'Sous l\'outil Bash, écrire les chemins Windows entre guillemets doubles et avec des barres obliques — les antislashes nus sont avalés par le shell POSIX.',
    extrait: CLAUDE_MD('Chemins Windows sous l\'outil Bash')
      + '- Toujours des barres obliques `/` et des guillemets : `cd "F:/DEV/mon-projet"`\n'
      + '- Jamais `cd F:\\DEV\\mon-projet` sans guillemets : le shell POSIX mange les antislashes.\n',
  },
  'inv-bash-cd-too-many-args': {
    consigne: 'Un `cd` vers un chemin qui contient des espaces doit être entre guillemets — sans eux, le chemin éclate en plusieurs arguments.',
    extrait: CLAUDE_MD('cd sous l\'outil Bash')
      + '- Toujours : `cd "F:/DEV/Mon Projet"` (guillemets, barres obliques).\n'
      + '- Jamais : `cd F:/DEV/Mon Projet` — deux arguments, le cd échoue.\n',
  },
  'inv-bash-trailing-backslash-in-path': {
    consigne: 'Jamais d\'antislash final dans un chemin entre guillemets : `"F:\\DEV\\"` — l\'antislash échappe le guillemet fermant et la chaîne ne se referme jamais.',
    extrait: CLAUDE_MD('Chemins Windows sous l\'outil Bash')
      + '- Pas d\'antislash final : `ls "F:/DEV/public"` et non `ls "F:\\DEV\\public\\"`.\n'
      + '- L\'antislash final échappe le guillemet fermant (`unexpected EOF`).\n',
  },
  'inv-bash-heredoc-too-large': {
    consigne: 'Ne pas écrire de fichier par heredoc (`cat > f <<\'EOF\'`) : au-delà de quelques kilo-octets la commande n\'arrive pas entière au shell. Utiliser l\'outil Write.',
    extrait: CLAUDE_MD('Écrire un fichier depuis Bash')
      + '- Pour créer ou remplir un fichier, utiliser l\'outil Write — jamais un heredoc.\n'
      + '- Un heredoc de plus de ~4 Ko arrive tronqué : guillemet jamais refermé.\n',
  },
  // Le FILET (doc/30) : il ne se declenche que lorsque aucune ancre ne
  // reconnait la forme — la cause n'est pas caracterisee, donc aucun remede
  // honnete. `null` est la reponse, pas une case vide.
  'inv-bash-unbalanced-quote': null,
  // Symptome generique du shell : pas UN reglage a poser, pas de remede unique.
  'inv-bash-syntax-error': null,
  'inv-ps-command-not-found': {
    consigne: 'Windows PowerShell 5.1 ne connaît pas les commandes Unix (head, tail, which, touch, wc…) : utiliser les équivalents PowerShell.',
    extrait: CLAUDE_MD('PowerShell 5.1 — commandes Unix absentes')
      + '- head/tail → `Get-Content f -TotalCount N` / `-Tail N`\n'
      + '- which → `(Get-Command nom).Source` ; wc -l → `(Get-Content f | Measure-Object -Line).Lines`\n',
  },
  'inv-ps-parameter-not-found': {
    consigne: 'Le poste exécute Windows PowerShell 5.1, pas PowerShell 7 : des paramètres récents n\'existent pas (ex. `ConvertFrom-Json -AsHashtable`).',
    extrait: CLAUDE_MD('PowerShell 5.1, pas 7')
      + '- Vérifier qu\'un paramètre existe en 5.1 avant de l\'employer.\n'
      + '- `ConvertFrom-Json` rend un PSCustomObject ; `-AsHashtable` n\'existe pas.\n',
  },
  'inv-ps-syntax': {
    consigne: 'Windows PowerShell 5.1 n\'a ni `&&`/`||` ni opérateur ternaire : chaîner avec `A; if ($?) { B }`.',
    extrait: CLAUDE_MD('PowerShell 5.1 — syntaxe')
      + '- Pas de `&&` ni `||` : `A; if ($?) { B }` pour le succès conditionnel.\n'
      + '- Pas de ternaire `?:` ni de `??` : if/else explicites.\n',
  },
  // Un argument refuse ou du mauvais type : la cause varie a chaque commande,
  // aucun reglage unique a poser.
  'inv-ps-argument-type': null,
  'inv-ps-argument-exception': null,
};

export function remedyFor(alert) {
  if (alert.type !== 'badInvocation') return null;
  return REMEDES[alert.patternId] ?? null;
}

// Découpage en jetons : commentaires retirés, chaînes et nombres neutralisés.
//
// LIMITE ASSUMÉE (doc/34), toujours vraie : découpage par expression
// rationnelle, pas par analyseur syntaxique — les identifiants sont conservés
// tels quels, donc un clone dont les variables ont été renommées n'est PAS
// détecté.
//
// CORRIGÉ (2026-08-10, arbitré par Vincent) : la phrase qui suivait ici disait
// « une division suivie d'une expression rationnelle littérale peut être mal
// découpée. Aucun cas connu dans ce dépôt, mais le risque existe. » — les deux
// moitiés de cette phrase étaient fausses. Des cas existaient (mesurés par la
// tâche 5 de doc/35), et le risque est maintenant couvert par une troisième
// alternative de `PATTERN`, une expression rationnelle littérale, placée
// APRÈS les deux alternatives de commentaire et AVANT les alternatives de
// chaîne — pour qu'un guillemet interne à la regex ne puisse plus jamais
// ouvrir une fausse chaîne.
//
// HEURISTIQUE (division vs regex, l'ambiguïté classique du lexing
// JavaScript, tranchée ici sans jeton précédent réel) : un `/` ouvre une
// regex SAUF si le caractère significatif qui précède peut terminer une
// VALEUR — un caractère d'identifiant ou de chiffre, `)`, ou `]` — auquel cas
// c'est une division. Exception nécessaire : si ce qui précède est un MOT-CLÉ
// RÉSERVÉ qui ne peut jamais être un identifiant (`return`, `typeof`,
// `instanceof`, `delete`, `void`, `throw`, `case`, `new`, `do`, `else`,
// `yield`, `await`, `in`, `default`, `extends`), un `/` qui suit reste une
// regex — sans quoi `return /pattern/;` serait mal découpé. `of` est
// délibérément EXCLU de cette liste : ce n'est PAS un mot réservé en
// JavaScript (`let of = 5; x = of / 2;` est un identifiant valide), l'y
// inclure aurait réintroduit le risque inverse — une vraie division prise
// pour une fausse regex.
//
// DEUX AMBIGUÏTÉS RÉSIDUELLES, NON RÉSOLUES PAR CONSTRUCTION — aucune des
// deux n'est LA seule, toutes deux sont écrites :
//
//   1. Le cas de `}` : `{}` peut fermer un bloc — une regex suit alors
//      presque toujours — ou un littéral objet, valeur qu'une division peut
//      suivre. `}` n'est PAS dans la classe qui bloque la regex : par défaut,
//      un `/` après `}` est traité comme une regex. Choix assumé : fermer un
//      bloc (fonction, `if`, boucle) est infiniment plus fréquent en code
//      réel que diviser un littéral objet, et le reste du dépôt ne contient
//      aucun cas du second type.
//
//   2. Une DIVISION qui suit IMMÉDIATEMENT une regex SANS DRAPEAU (trouvé par
//      la revue, 2026-08-10). Une regex sans drapeau se termine par un `/`
//      nu ; la lookbehind disqualifiante ne reconnaît que `)`, `]`, une fin
//      de nombre ou une fin d'identifiant comme fin de VALEUR — pas ce `/`
//      final. La division qui suit est donc lue comme ouvrant une SECONDE
//      regex, qui avale tout jusqu'au prochain `/` littéral. Reproduit :
//      `const r = /re/ / 2; const s = 10 / 5;` tokenise en
//      `["const","r","=","/re/","/ 2; const s = 10 /","NUM",";"]` — le
//      deuxième `/` de `/re/` combiné à celui de la division fabrique une
//      fausse regex qui avale `2; const s = 10 ` en entier, la même famille
//      de panne que celle que cette heuristique existe pour éliminer,
//      atteinte par une autre route. Corollaire vérifié : une regex AVEC
//      drapeau est saine, car la lettre du drapeau se lit comme un
//      pseudo-identifiant et disqualifie le `/` suivant :
//      `const r = /re/g / 2; const s = 10 / 5;` tokenise correctement en
//      `["const","r","=","/re/g","/","NUM",";","const","s","=","NUM","/","NUM",";"]`.
//      VÉRIFIÉ ABSENT de ce dépôt à ce commit (642 portées D5 stables,
//      `d1.json` identique au jeton près, 0 fichier déséquilibré sur 113
//      après le correctif de cette même tâche) : c'est une limite NOMMÉE, pas
//      un défaut vivant. Non corrigée — chaque changement du socle coûte un
//      nouveau cycle D1/D5 et une revue, pour un cas absent de ce corpus.
//      Arbitrage du contrôleur (2026-08-10).
//
// Une expression rationnelle littérale émet SON TEXTE BRUT comme valeur de
// jeton, jamais un `'STR'` générique : `/foo/` et `/bar/` restent deux jetons
// différents. Nécessaire pour D1 — un jeton unique aurait rendu deux blocs de
// code identiques SAUF pour leur motif indiscernables l'un de l'autre, un
// FAUX POSITIF de clone à la place du FAUX NÉGATIF corrigé ici.
//
// MESURÉ sur ce dépôt, à ce commit (113 fichiers du périmètre, avant → après
// ce correctif) :
//   - flux d'accolades global déséquilibré : 3 fichiers → 0 fichier.
//   - `netgain/src/router/detector.ts` : 0 fonction détectée → 1
//     (`detectGraphSignal`, ligne 54), la seule du fichier.
//   - `netgain/src/doctor/aggregators/agent-gestures.ts` : 3 fonctions
//     détectées → 4 (`detectAgentGesture`, ligne 33, récupérée) ; la portée de
//     `hasImportShape` était fausse de 21-50 (30 lignes), elle est maintenant
//     21-24 (4 lignes réelles).
//   - Deux fichiers de plus, JAMAIS signalés par le test de flux d'accolades
//     (la panne y était silencieuse — un tronçon avalé dont le contenu était
//     lui-même équilibré) : `lib/install-hooks.js` avait DEUX fonctions
//     fusionnées en une seule portée (71-87) par un guillemet piégé dans
//     `/\/hook\.js(["'\s]|$)/` (ligne 76) — séparées maintenant en 71-77
//     (`isAgentVizHook`) et 83-87 (`isStandardShape`) ; et
//     `netgain/src/doctor/aggregators/prompts.ts` passait de 0 fonction
//     détectée à 2 (`classifyPrompt` 26-31, `isNoisePrompt` 34-38). Le vrai
//     compte de fichiers touchés était donc au moins 5, jamais 3 — la
//     désynchronisation silencieuse mesurée par la tâche 5 de doc/35 est
//     confirmée, pas seulement supposée.
//   - D1 (`docs/audit/resultats/d1.json`) : les 7 groupes de clones et leurs
//     0 groupes inter-zone sont IDENTIQUES avant/après, jeton par jeton — le
//     correctif ne fait apparaître ni ne fait disparaître aucun clone.
const PATTERN =
  /\/\*[\s\S]*?\*\/|\/\/[^\n]*|(?<!\)\s*|\]\s*|[0-9][0-9_]*(?:\.[0-9_]*)?\s*|\b(?!(?:return|typeof|instanceof|delete|void|throw|case|new|do|else|yield|await|in|default|extends)\b)[A-Za-z_$][\w$]*\s*)\/(?![*\/])(?:\\.|\[(?:\\.|[^\]\n])*\]|[^\/\\\n])+\/[dgimsuvy]*|`(?:\\[\s\S]|[^`\\])*`|'(?:\\[\s\S]|[^'\\])*'|"(?:\\[\s\S]|[^"\\])*"|[A-Za-z_$][\w$]*|\d[\d_]*(?:\.\d[\d_]*)?|\S/g;

export function tokenize(text) {
  const out = [];
  let line = 1;
  let cursor = 0;
  for (const match of text.matchAll(PATTERN)) {
    for (let i = cursor; i < match.index; i++) if (text[i] === '\n') line++;
    const raw = match[0];
    const isComment = raw.startsWith('//') || raw.startsWith('/*');
    if (!isComment) {
      const first = raw[0];
      const v = (first === '"' || first === "'" || first === '`') ? 'STR'
        : /^\d/.test(raw) ? 'NUM'
        : raw;
      out.push({ v, line });
    }
    for (const ch of raw) if (ch === '\n') line++;
    cursor = match.index + raw.length;
  }
  return out;
}

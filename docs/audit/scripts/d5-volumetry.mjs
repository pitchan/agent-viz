// D5 — volumétrie. OUTIL DE TRIAGE, JAMAIS UN VERDICT (doc/34).
//
// Aucun seuil de taille ne figure dans le CLAUDE.md du dépôt : un fichier long
// n'est en infraction de rien. On publie une distribution — médiane,
// percentile 90, maximum — et les extrêmes ouvrent une enquête.
//
// LA MÉTRIQUE PORTE SON PÉRIMÈTRE DANS SON NOM : `fonctionsMotCleFunction`.
// Elle ne compte QUE les déclarations par le mot-clé `function`, imbriquées
// comprises. Les fonctions fléchées et les méthodes de classe ou d'objet en
// sont absentes. La v1 appelait ça « fonctions » tout court, ce qui laissait
// croire à une couverture qu'elle n'avait pas.
//
// Le comptage d'accolades se fait sur les JETONS, donc une accolade dans une
// chaîne ou un commentaire ne le fausse pas — c'est l'objet du contrôle négatif.
//
// LIMITE CONSTATÉE, NON CORRIGÉE (2026-08-10) : `functionSpans` dépend du
// comptage d'accolades sur les jetons de `tokenize`, et ce comptage peut être
// désynchronisé par un guillemet non apparié à l'intérieur d'une expression
// rationnelle littérale — même famille que la limite déjà nommée dans l'en-
// tête de `lib/tokens.mjs` et dans celui de D4. Contrairement à D4, la panne
// n'est PAS à sens unique ici : une accolade réelle avalée dans une fausse
// chaîne peut aussi bien faire DISPARAÎTRE une fonction du décompte que faire
// GONFLER la portée mesurée d'une autre.
//
// Mesuré sur ce dépôt, à ce commit, sur les 113 fichiers du périmètre : le
// flux d'accolades du fichier entier (comptage brut de tous les `{`/`}`
// jetonisés) ne revient à zéro que pour 110 d'entre eux. Test FAIBLE — une
// chaîne factice dont le contenu avalé est lui-même équilibré ne laisse
// aucune trace — donc le vrai compte de fichiers touchés est ≥ 3, jamais < 3.
// Les 3 exceptions, chiffres recomptés à la main puis confirmés par une
// réimplémentation indépendante du tokeniseur qui conserve la ligne de fin de
// chaque jeton :
//
//   - `public/viz-invocation-patterns.mjs` (fin de flux +4) : 14 chaînes
//     factices entre les lignes 153 et 328, dans la table `PATTERNS` (un
//     guillemet anglais du type « doesn't », des apostrophes d'identifiants
//     `id: '…'` adjacents). La seule fonction du fichier, `classify`
//     (ligne 350), est mesurée JUSTE (350-369, fermeture réelle confirmée) :
//     toute la corruption se produit avant elle et ne la touche pas. Chance
//     de position, pas garantie — un fichier dont la fonction se trouverait
//     après une telle table ne serait pas protégé.
//   - `netgain/src/doctor/aggregators/agent-gestures.ts` (fin de flux -1) :
//     4 déclarations `function` réelles (lignes 16, 21, 27, 33), D5 n'en
//     rapporte que 3. `normalizePattern` (16-18) et `isSingleFilePath`
//     (27-29) sont justes. L'apostrophe de la classe de caractères `['"]`,
//     ligne 23, ouvre une fausse chaîne (23-26) qui avale l'accolade fermante
//     réelle de `hasImportShape` (ligne 24) et ne se referme que sur
//     l'apostrophe de « qu'importe », ligne 26 ; `hasImportShape` est donc
//     rapportée 21-50 (30 lignes) au lieu de 21-24 (4 lignes réelles) — un
//     facteur 7,5. L'apostrophe adjacente à l'accent grave de la classe
//     `[\s|;&("'` + BACKTICK + `])`, ligne 31, ouvre une seconde fausse
//     chaîne (31-34) qui avale entièrement la déclaration de
//     `detectAgentGesture` (ligne 33, mot-clé compris) ; une cascade de
//     petites chaînes factices du même type continue jusqu'à la ligne 49 sur
//     les littéraux du corps de cette fonction. Résultat : `detectAgentGesture`
//     n'apparaît JAMAIS comme jeton `function` — zéro occurrence dans D5, un
//     dans le fichier réel.
//   - `netgain/src/router/detector.ts` (fin de flux +1) : la seule fonction du
//     fichier, `detectGraphSignal` (ligne 54), est ELLE AUSSI invisible — D5
//     rapporte zéro `fonctionsMotCleFunction` pour un fichier qui en contient
//     un. La classe `d['’]` (apostrophe suivie d'une guillemet courbe),
//     ligne 22, amorce une chaîne de 4 fausses chaînes successives (22-25,
//     25-34, 34-44, 44-65) qui avalent, l'une après l'autre, les frontières
//     des quatre entrées de la table `SIGNALS` et la déclaration de
//     `detectGraphSignal` tout entière.
//
// Aucune des 637 portées publiées dans `docs/audit/resultats/d5.json` n'est
// « impossible » au sens strict (`ligneFin` avant `ligneDebut`, ou longueur
// supérieure au nombre de lignes du fichier) : ce test ne débusque rien de
// plus que les 3 fichiers ci-dessus. Le maximum publié
// (`distribution.fonctionsMotCleFunction.max` = 162 lignes,
// `netgain/src/doctor/report/terminal.ts`, fonction `renderReport`,
// lignes 286-447) est VÉRIFIÉ SAIN : flux d'accolades du fichier équilibré
// (fin à 0), et les 16 occurrences du mot « function » dans le texte brut
// correspondent aux 16 jetons `function` survivants — aucune perte. Le second
// maximum (155 lignes, `netgain/src/map/env.ts`, 470-624) vient d'un fichier
// tout aussi équilibré (fin à 0).
//
// Cette limite ne touche QUE `fonctionsMotCleFunction` : `lignes` et
// `exports` ne dépendent pas de `tokenize` et ne sont pas concernés.
//
// D5 reste utilisable comme instrument de triage — la distribution publiée
// n'est pas déplacée par la corruption connue (max et p90 proviennent de
// fichiers sains) — mais `parFichier` ne doit jamais être lu comme un
// décompte exact, fichier par fichier, sans recomptage manuel. Non corrigée :
// même limite structurelle que D4 et que `lib/tokens.mjs`, qui l'énonçait déjà
// sans l'avoir mesurée ; un vrai analyseur lexical est requis pour la lever,
// hors mandat et hors budget zéro-dépendance de cet audit.
import { tokenize } from './lib/tokens.mjs';

function functionSpans(tokens) {
  const spans = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].v !== 'function') continue;
    let j = i;
    while (j < tokens.length && tokens[j].v !== '{') j++;
    if (j >= tokens.length) break;
    let depth = 0;
    for (; j < tokens.length; j++) {
      if (tokens[j].v === '{') depth++;
      else if (tokens[j].v === '}' && --depth === 0) break;
    }
    spans.push({ ligneDebut: tokens[i].line, ligneFin: tokens[Math.min(j, tokens.length - 1)].line });
    // on NE saute PAS jusqu'à la fin : les fonctions imbriquées doivent être
    // comptées elles aussi.
  }
  return spans;
}

const stats = (values) => {
  if (values.length === 0) return { mediane: 0, p90: 0, max: 0 };
  const s = [...values].sort((a, b) => a - b);
  return {
    mediane: s[Math.floor(s.length / 2)],
    p90: s[Math.min(s.length - 1, Math.floor(s.length * 0.9))],
    max: s[s.length - 1],
  };
};

export function measure(files) {
  const parFichier = files.map(file => ({
    path: file.path,
    zone: file.zone,
    lignes: file.text.split('\n').length,
    exports: (file.text.match(/^\s*(?:export\s|module\.exports)/gm) ?? []).length,
    fonctionsMotCleFunction: functionSpans(tokenize(file.text)),
  }));
  const longueurs = parFichier.flatMap(f => f.fonctionsMotCleFunction.map(s => s.ligneFin - s.ligneDebut + 1));
  return {
    parFichier: parFichier.sort((a, b) => b.lignes - a.lignes),
    distribution: {
      lignes: stats(parFichier.map(f => f.lignes)),
      fonctionsMotCleFunction: stats(longueurs),
      exports: stats(parFichier.map(f => f.exports)),
    },
  };
}

// D4 — graphe d'imports. Des faits, AUCUNE conclusion.
//
// La liste des modules important `fs`, `http` ou `https` n'est PAS une liste de
// violations : un adaptateur de fichiers a le droit d'importer `fs`, c'est son
// métier. Seule la passe humaine décide si le fichier porte de la règle métier,
// et cette décision est signée (doc/34).
//
// `nonResolus` existe pour une raison précise : un spécificateur relatif que la
// résolution rate disparaît du graphe, et l'absence de cycle devient alors un
// FAUX NÉGATIF invérifiable. On publie donc les ratés — un rapport qui annonce
// « aucun cycle » sans dire combien d'arêtes il n'a pas vues ment par omission.
//
// Le seuil de fan-in « anormal » est le percentile 90 de la distribution
// OBSERVÉE, pas un chiffre rond choisi d'avance.
//
// LIMITE CONSTATÉE PUIS CORRIGÉE (2026-08-10) : SPEC, appliqué au texte brut,
// ne distingue pas le code d'un commentaire. Mesuré sur ce dépôt : 3
// spécificateurs sur 763 vivaient dans un commentaire, dont l'exemple d'API
// de `lib/install-hooks.js` (`// const {...} = require('./install-hooks');`)
// qui fabriquait un cycle d'un seul sommet — le détecteur ne se contentait
// donc pas de RATER des arêtes (`nonResolus`), il pouvait aussi en INVENTER.
// Correctif (arbitré par Vincent) : les commentaires sont neutralisés avant
// le balayage (`sansCommentaires`, ci-dessous), les chaînes étant reconnues
// EN PREMIER pour qu'un `//` littéral dans une URL survive. SPEC lui-même,
// la liste de candidats de résolution et `IO_MODULES` restent inchangés.
//
// Ce qui reste NON couvert par ce correctif, faute d'usage constaté pour le
// justifier : `usesFetch`, plus bas, teste le texte BRUT, pas neutralisé — un
// `fetch(` écrit dans un commentaire fabriquerait un import d'I/O fantôme
// exactement sur le même principe. Mesuré sur ce dépôt à ce commit : aucun
// cas (`fetch(` n'apparaît jamais UNIQUEMENT dans un commentaire) — c'est
// donc une zone aveugle non déclenchée, pas un défaut corrigé. Par ailleurs
// la première alternative de SPEC (`import|export ... from ...`) utilise
// `[^'"()]*?` qui franchit toujours les retours à la ligne : une construction
// inhabituelle en code réel (pas en commentaire) pourrait en principe encore
// faire pont entre deux instructions distinctes.
//
// LIMITE CONSTATÉE, NON CORRIGÉE (2026-08-10) : `sansCommentaires` peut lui
// aussi se faire déjouer. Un guillemet non apparié à l'intérieur d'une
// expression rationnelle littérale (une classe de caractères comme `["'\s]`,
// ou simplement une contraction anglaise comme `doesn't` écrite en clair dans
// le motif) désynchronise l'alternative « chaîne » de `COMMENTAIRE_OU_CHAINE` :
// elle croit ouvrir une chaîne à cet endroit et avale tout, verbatim, jusqu'au
// PROCHAIN guillemet identique rencontré — des commentaires entiers peuvent se
// retrouver emportés dans ce tronçon et en ressortir intacts, jamais blanchis.
// Mesuré sur ce dépôt, à ce commit : `lib/install-hooks.js` (4 lignes de
// commentaire non blanchies, 79-82, le bloc « Standard shape », déclenché par
// les guillemets de `["'\s]` aux lignes 75-76) et
// `public/viz-invocation-patterns.mjs` (29 lignes de commentaire non
// blanchies, comptées une à une : 155-160, 163-164, 176-178, 228-234, 237-242,
// 324-328 — la plage 228-242 contient deux lignes de CODE réel, 235-236, qui
// ne sont pas concernées).
//
// Panne À SENS UNIQUE : un commentaire peut donc survivre sans être examiné,
// mais aucun caractère de code réel n'est jamais changé en espace par ce
// mécanisme — le risque est une FAUSSE arête, jamais une arête perdue.
// Dormante dans cet état du dépôt : les lignes non blanchies ci-dessus ne
// contiennent, vérifié une à une, ni `require(...)` ni `import ... from` —
// aucune arête supplémentaire n'en résulte aujourd'hui. Non corrigée :
// distinguer une expression rationnelle littérale d'une division réclame le
// jeton significatif précédent, l'ambiguïté classique de lexing JavaScript,
// insoluble par une seule alternation — `lib/tokens.mjs` nomme déjà cette même
// famille de limite dans son propre en-tête. La résoudre proprement
// demanderait un vrai analyseur lexical, hors mandat et hors budget
// zéro-dépendance de cet audit.
//
// Autre limite constatée : un spécificateur relatif qui vise un fichier réel
// mais d'une extension hors périmètre (`.js`/`.mjs`/`.ts` seulement — voir
// lib/source-files.mjs) ne résout jamais et finit dans `nonResolus` sans être
// une faute de frappe. Constaté sur `lib/server/observatory/engine.js` →
// `../../../package.json`.
const SPEC = /(?:^|[\s;{(])(?:import|export)\s[^'"()]*?from\s*['"]([^'"]+)['"]|(?:^|[\s;{(=])require\s*\(\s*['"]([^'"]+)['"]\s*\)|(?:^|[\s;{(=])import\s*\(\s*['"]([^'"]+)['"]\s*\)|(?:^|[\s;{(])import\s*['"]([^'"]+)['"]/g;

const IO_MODULES = new Set([
  'fs', 'node:fs', 'fs/promises', 'node:fs/promises',
  'http', 'node:http', 'https', 'node:https',
  'child_process', 'node:child_process', 'net', 'node:net',
]);

const dirOf = (p) => p.slice(0, p.lastIndexOf('/'));

function normalise(base, spec) {
  const out = [];
  for (const part of `${base}/${spec}`.split('/')) {
    if (part === '.' || part === '') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

// Neutralisation des commentaires avant le balayage. Les chaînes sont
// reconnues AVANT les commentaires — sans quoi le « // » d'une URL littérale
// effacerait la fin de sa ligne. Les commentaires deviennent des espaces, pas
// du vide : aucun décalage, aucun retour à la ligne perdu.
const COMMENTAIRE_OU_CHAINE =
  /\/\*[\s\S]*?\*\/|\/\/[^\n]*|`(?:\\[\s\S]|[^`\\])*`|'(?:\\[\s\S]|[^'\\])*'|"(?:\\[\s\S]|[^"\\])*"/g;

const sansCommentaires = (text) =>
  text.replace(COMMENTAIRE_OU_CHAINE, (m) =>
    (m.startsWith('//') || m.startsWith('/*')) ? m.replace(/[^\n]/g, ' ') : m);

export function buildGraph(files) {
  const known = new Set(files.map(f => f.path));
  const edges = new Map();
  const external = new Map();
  const nonResolus = [];
  for (const file of files) {
    const internal = [];
    const outside = [];
    for (const match of sansCommentaires(file.text).matchAll(SPEC)) {
      const spec = match[1] ?? match[2] ?? match[3] ?? match[4];
      if (!spec) continue;
      if (!spec.startsWith('.')) { outside.push(spec); continue; }
      const base = normalise(dirOf(file.path), spec);
      const tries = [
        base, base.replace(/\.js$/, '.ts'),
        `${base}.js`, `${base}.mjs`, `${base}.ts`,
        `${base}/index.js`, `${base}/index.mjs`, `${base}/index.ts`,
      ];
      const hit = tries.find(t => known.has(t));
      if (hit) internal.push(hit);
      else nonResolus.push({ path: file.path, spec });
    }
    edges.set(file.path, [...new Set(internal)]);
    external.set(file.path, [...new Set(outside)]);
  }
  return { edges, external, nonResolus };
}

function findCycles(edges) {
  const cycles = [];
  const state = new Map();
  const stack = [];
  const visit = (node) => {
    state.set(node, 'open');
    stack.push(node);
    for (const next of edges.get(node) ?? []) {
      if (state.get(next) === 'open') cycles.push(stack.slice(stack.indexOf(next)));
      else if (!state.has(next)) visit(next);
    }
    stack.pop();
    state.set(node, 'done');
  };
  for (const node of edges.keys()) if (!state.has(node)) visit(node);
  return cycles;
}

export function analyseGraph(files) {
  const { edges, external, nonResolus } = buildGraph(files);
  const counts = new Map(files.map(f => [f.path, 0]));
  for (const targets of edges.values()) {
    for (const t of targets) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  const fanIn = [...counts].map(([path, count]) => ({ path, count })).sort((a, b) => b.count - a.count);
  const sorted = fanIn.map(f => f.count).sort((a, b) => a - b);
  const seuilP90 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))] : 0;

  const importsDIO = [];
  for (const file of files) {
    const modules = (external.get(file.path) ?? []).filter(m => IO_MODULES.has(m));
    const usesFetch = /\bfetch\s*\(/.test(file.text);
    if (modules.length || usesFetch) {
      importsDIO.push({
        path: file.path, zone: file.zone,
        modules: [...modules, ...(usesFetch ? ['(fetch global)'] : [])].sort(),
      });
    }
  }
  return { fanIn, seuilP90, cycles: findCycles(edges), importsDIO, nonResolus };
}

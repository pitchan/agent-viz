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
// LIMITE CONSTATÉE À L'EXÉCUTION SUR LE VRAI DÉPÔT (2026-08-10) : SPEC ne
// distingue pas le code d'un commentaire. Un `require(...)` écrit en toutes
// lettres dans un commentaire documentaire est capté comme une arête réelle —
// le détecteur ne se contente donc pas de RATER des arêtes (`nonResolus`), il
// peut aussi en INVENTER. Preuve : `lib/install-hooks.js` documente son API
// dans un commentaire `// const {...} = require('./install-hooks');` et se
// retrouve avec un cycle d'un seul sommet qu'aucun code exécuté ne produit.
// Tout cycle rapporté doit donc être relu sur le fichier source avant d'être
// cru, dans les deux sens : un vrai peut manquer, un faux peut apparaître.
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

export function buildGraph(files) {
  const known = new Set(files.map(f => f.path));
  const edges = new Map();
  const external = new Map();
  const nonResolus = [];
  for (const file of files) {
    const internal = [];
    const outside = [];
    for (const match of file.text.matchAll(SPEC)) {
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

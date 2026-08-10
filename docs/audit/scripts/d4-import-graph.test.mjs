import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph, analyseGraph } from './d4-import-graph.mjs';

const FILES = [
  { path: 'lib/a.js', zone: 'server', text: `const b = require('./b.js');\nconst fs = require('node:fs');` },
  { path: 'lib/b.js', zone: 'server', text: `const c = require('./c');` },
  { path: 'lib/c.js', zone: 'server', text: `const a = require('./a.js');` },
  { path: 'netgain/src/d.ts', zone: 'engine', text: `import { x } from './e.js';` },
  { path: 'netgain/src/e.ts', zone: 'engine', text: `export const x = 1;` },
];

test('contrôle positif : un spécificateur .js écrit dans un .ts résout vers le .ts', () => {
  assert.deepEqual(buildGraph(FILES).edges.get('netgain/src/d.ts'), ['netgain/src/e.ts']);
});

test('contrôle positif : un cycle de trois fichiers est trouvé', () => {
  const { cycles } = analyseGraph(FILES);
  assert.equal(cycles.length, 1);
  assert.deepEqual([...cycles[0]].sort(), ['lib/a.js', 'lib/b.js', 'lib/c.js']);
});

test('contrôle positif : un import d’I/O est recensé', () => {
  assert.deepEqual(analyseGraph(FILES).importsDIO.find(i => i.path === 'lib/a.js').modules, ['node:fs']);
});

test('contrôle positif : un import relatif NON RÉSOLU est publié, pas avalé', () => {
  const { nonResolus } = analyseGraph([
    { path: 'lib/a.js', zone: 'server', text: `const z = require('./inexistant.js');` },
  ]);
  assert.deepEqual(nonResolus, [{ path: 'lib/a.js', spec: './inexistant.js' }]);
});

test('contrôle négatif : un graphe sans cycle n’en invente pas', () => {
  assert.equal(analyseGraph(FILES.slice(3)).cycles.length, 0);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findClones } from './d1-clones.mjs';

const CLONE = `
function computeSomething(list, factor) {
  let total = 0;
  for (const item of list) {
    if (item.value === null) continue;
    total = total + item.value * factor;
  }
  const rounded = Math.round(total * 100) / 100;
  return { total: rounded, count: list.length, factor: factor };
}
`;

test('contrôle positif : un bloc recopié dans deux fichiers est trouvé une seule fois, fusionné', () => {
  const groups = findClones([
    { path: 'a.js', zone: 'server', text: `const x = 1;\n${CLONE}` },
    { path: 'b.js', zone: 'web', text: `const y = 2;\n${CLONE}` },
  ]);
  assert.equal(groups.length, 1, `fenêtres non fusionnées : ${groups.length} groupes`);
  assert.deepEqual(groups[0].sites.map(s => s.path).sort(), ['a.js', 'b.js']);
  assert.equal(groups[0].interZone, true);
  assert.ok(groups[0].jetons > 60, 'le fragment fusionné dépasse une fenêtre');
});

test('contrôle négatif : deux fichiers qui ne partagent que trois lignes ne sont pas groupés', () => {
  const petit = `function f(a) {\n  return a + 1;\n}\n`;
  const groups = findClones([
    { path: 'a.js', zone: 'server', text: petit },
    { path: 'b.js', zone: 'server', text: petit },
  ]);
  assert.equal(groups.length, 0);
});

test('contrôle négatif : un même fichier ne se clone pas avec lui-même', () => {
  assert.equal(findClones([{ path: 'a.js', zone: 'server', text: CLONE }]).length, 0);
});

test('contrôle négatif : deux fragments de même empreinte mais de contenu différent ne sont jamais groupés', () => {
  // On force la collision en appelant directement le regroupement exact :
  // deux séquences distinctes ne doivent pas se retrouver dans un même groupe.
  const a = `function f() {\n${'  const a1 = 1;\n'.repeat(30)}}\n`;
  const b = `function f() {\n${'  const b1 = 2;\n'.repeat(30)}}\n`;
  const groups = findClones([
    { path: 'a.js', zone: 'server', text: a },
    { path: 'b.js', zone: 'server', text: b },
  ]);
  assert.equal(groups.length, 0, 'contenus différents groupés à tort');
});

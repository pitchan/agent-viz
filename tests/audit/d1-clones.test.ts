import { expect, test } from 'vitest';
import { findClones } from '../../docs/audit/scripts/d1-clones.ts';

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
  expect(groups.length, `fenêtres non fusionnées : ${groups.length} groupes`).toBe(1);
  expect(groups[0]!.sites.map(s => s.path).sort()).toEqual(['a.js', 'b.js']);
  expect(groups[0]!.interZone).toBe(true);
  expect(groups[0]!.jetons > 60, 'le fragment fusionné dépasse une fenêtre').toBeTruthy();
});

test('contrôle négatif : deux fichiers qui ne partagent que trois lignes ne sont pas groupés', () => {
  const petit = `function f(a) {\n  return a + 1;\n}\n`;
  const groups = findClones([
    { path: 'a.js', zone: 'server', text: petit },
    { path: 'b.js', zone: 'server', text: petit },
  ]);
  expect(groups.length).toBe(0);
});

test('contrôle négatif : un même fichier ne se clone pas avec lui-même', () => {
  expect(findClones([{ path: 'a.js', zone: 'server', text: CLONE }]).length).toBe(0);
});

test('contrôle négatif : deux fragments de contenu différent ne sont jamais groupés', () => {
  // Ce contrôle vérifie que deux contenus distincts restent séparés. Il
  // n'exerce PAS la levée de collision d'empreinte : forcer deux séquences de
  // 60 jetons dans un même seau demanderait de piloter `fingerprint`, qui n'est
  // pas exporté. Cette garantie-là reste structurelle et non couverte par un
  // test — l'étape 2 regroupe sur la séquence de jetons elle-même, jamais sur
  // l'empreinte.
  const a = `function f() {\n${'  const a1 = 1;\n'.repeat(30)}}\n`;
  const b = `function f() {\n${'  const b1 = 2;\n'.repeat(30)}}\n`;
  const groups = findClones([
    { path: 'a.js', zone: 'server', text: a },
    { path: 'b.js', zone: 'server', text: b },
  ]);
  expect(groups.length, 'contenus différents groupés à tort').toBe(0);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLcov, coverageReport } from './d6-coverage.mjs';

const LCOV = `TN:
SF:lib\\server\\pricing.js
LF:100
LH:45
end_of_record
TN:
SF:public/viz-ui.js
LF:50
LH:50
end_of_record
`;

test('contrôle positif : le LCOV est lu et les antislashes normalisés', () => {
  const m = parseLcov(LCOV);
  assert.deepEqual(m.get('lib/server/pricing.js'), { hit: 45, found: 100 });
  assert.deepEqual(m.get('public/viz-ui.js'), { hit: 50, found: 50 });
});

test('contrôle positif : un fichier du moteur importé par un test est « atteignable »', () => {
  const files = [
    { path: 'netgain/src/a.ts', zone: 'engine', text: 'export const a = 1;' },
    { path: 'netgain/src/b.ts', zone: 'engine', text: 'export const b = 2;' },
  ];
  const tests = [{ path: 'netgain/tests/a.test.ts', zone: 'tests-engine', text: `import { a } from '../src/a.js';` }];
  const r = coverageReport(files, tests, LCOV);
  assert.ok(r.atteignableStatiquement.includes('netgain/src/a.ts'));
  assert.ok(r.inatteignable.includes('netgain/src/b.ts'));
});

test('contrôle négatif : un fichier absent du LCOV est « sans preuve d’exécution », pas « non testé »', () => {
  const r = coverageReport([{ path: 'lib/server/tokens.js', zone: 'server', text: 'module.exports = {};' }], [], LCOV);
  assert.deepEqual(r.sansPreuveDExecution, ['lib/server/tokens.js']);
  assert.ok(r.limites.some(l => l.includes('dynamique')));
});

// Fix round 1 — le défaut réel, en miniature. Deux blocs SF: pour le MÊME
// chemin (cas réel : un fichier réimporté dynamiquement plusieurs fois dans
// la même suite), chacun avec ses propres lignes DA:. Ligne 1 couverte
// seulement par le premier bloc, ligne 2 seulement par le second, ligne 3 par
// aucun des deux. L'union attendue est 2 lignes couvertes sur 3 — pas le
// dernier bloc lu qui écraserait le premier.
test('contrôle positif : deux blocs SF: pour le même chemin sont UNIS via les lignes DA:, pas le dernier qui écrase le premier', () => {
  const DEUX_BLOCS = `TN:
SF:lib\\server\\shared.js
DA:1,1
DA:2,0
DA:3,0
LF:3
LH:1
end_of_record
TN:
SF:lib\\server\\shared.js
DA:1,0
DA:2,1
DA:3,0
LF:3
LH:1
end_of_record
`;
  assert.deepEqual(parseLcov(DEUX_BLOCS).get('lib/server/shared.js'), { hit: 2, found: 3 });
});

// Fix round 1 — indépendance à l'ordre. Mêmes deux blocs que ci-dessus dans
// l'idée, mais avec des LH: délibérément DIFFÉRENTS (1 puis 2) pour qu'un
// « dernier bloc gagne » produise deux réponses distinctes selon l'ordre.
// L'union réelle (les 3 lignes sont couvertes par l'un ou l'autre bloc) doit
// être identique quel que soit l'ordre de lecture des blocs.
test('contrôle positif : le résultat ne dépend pas de l’ordre des blocs SF:', () => {
  const BLOC_A = 'TN:\nSF:lib\\server\\ordre.js\nDA:1,1\nDA:2,0\nDA:3,0\nLF:3\nLH:1\nend_of_record\n';
  const BLOC_B = 'TN:\nSF:lib\\server\\ordre.js\nDA:1,0\nDA:2,1\nDA:3,1\nLF:3\nLH:2\nend_of_record\n';
  const ab = parseLcov(BLOC_A + BLOC_B).get('lib/server/ordre.js');
  const ba = parseLcov(BLOC_B + BLOC_A).get('lib/server/ordre.js');
  assert.deepEqual(ab, ba);
  assert.deepEqual(ab, { hit: 3, found: 3 });
});

// Fix round 1 — le repli. Un bloc SANS aucune ligne DA: (seulement LH:/LF:,
// comme le fixture LCOV du contrôle du plan ci-dessus) doit continuer à
// donner exactement LH:/LF:, inchangé. Ce contrôle est VERT dès avant le
// correctif : il garde le contrôle du plan lui-même au vert sans qu'on y
// touche.
test('contrôle positif : un bloc sans DA: garde LH:/LF: tel quel (repli, comportement inchangé)', () => {
  const SANS_DA = 'TN:\nSF:lib\\server\\sans-da.js\nLF:10\nLH:7\nend_of_record\n';
  assert.deepEqual(parseLcov(SANS_DA).get('lib/server/sans-da.js'), { hit: 7, found: 10 });
});

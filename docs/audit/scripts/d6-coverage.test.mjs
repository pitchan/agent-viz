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

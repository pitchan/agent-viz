import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sources, testFiles } from './source-files.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

test('contrôle positif : les trois zones sont peuplées et correctement étiquetées', () => {
  const byPath = new Map(sources(ROOT).map(f => [f.path, f]));
  assert.equal(byPath.get('lib/server/pricing.js')?.zone, 'server');
  assert.equal(byPath.get('public/viz-ui.js')?.zone, 'web');
  assert.equal(byPath.get('netgain/src/core/pricing.ts')?.zone, 'engine');
  assert.equal(byPath.get('bin/agent-viz.js')?.zone, 'server');
  assert.ok(byPath.get('lib/server/pricing.js').text.includes('FALLBACK'));
});

test('contrôle négatif : le généré, les fixtures et l’audit lui-même sont hors périmètre', () => {
  for (const f of sources(ROOT)) {
    assert.ok(!f.path.startsWith('netgain/dist/'), `généré inclus : ${f.path}`);
    assert.ok(!f.path.startsWith('docs/'), `l’audit s’audite lui-même : ${f.path}`);
    assert.ok(!f.path.includes('node_modules/'), `dépendance incluse : ${f.path}`);
    assert.ok(!f.path.includes('tests/fixtures/'), `fixture incluse : ${f.path}`);
    assert.ok(!f.path.startsWith('tests/'), `test dans les sources : ${f.path}`);
  }
});

test('les fichiers de tests sont accessibles à part, pour la couverture', () => {
  const t = testFiles(ROOT).map(f => f.path);
  assert.ok(t.includes('tests/unit/pricing-engine-mirror.test.js'));
  assert.ok(t.some(p => p.startsWith('netgain/tests/')));
});

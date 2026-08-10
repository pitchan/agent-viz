import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyMatrix } from './d7-boundary.mjs';

const FILES = [
  { path: 'lib/server/transcript.js', zone: 'server', text: `const lines = content.split('\\n');` },
  { path: 'netgain/src/core/jsonl.ts', zone: 'engine', text: `const lines = text.split('\\n');` },
];

test('contrôle positif : une matrice exacte est déclarée cohérente', () => {
  const r = verifyMatrix(FILES, [{
    geste: 'decodage-jsonl', verdict: 'duplique', raison: 'même découpage des deux côtés',
    motif: /\.split\((['"`])\\n\1\)/,
    coteServeur: ['lib/server/transcript.js'], coteMoteur: ['netgain/src/core/jsonl.ts'],
  }]);
  assert.equal(r.coherente, true);
  assert.deepEqual(r.gestes[0].sitesManquants, []);
  assert.deepEqual(r.gestes[0].sitesInattendus, []);
});

test('contrôle négatif : un site déclaré qui n’existe plus fait ÉCHOUER la vérification', () => {
  const r = verifyMatrix(FILES, [{
    geste: 'decodage-jsonl', verdict: 'duplique', raison: '…',
    motif: /\.split\((['"`])\\n\1\)/,
    coteServeur: ['lib/server/disparu.js'], coteMoteur: ['netgain/src/core/jsonl.ts'],
  }]);
  assert.equal(r.coherente, false);
  assert.deepEqual(r.gestes[0].sitesManquants, ['lib/server/disparu.js']);
});

test('contrôle négatif : un site NON DÉCLARÉ qui correspond au motif est signalé', () => {
  const r = verifyMatrix([...FILES, { path: 'lib/server/nouveau.js', zone: 'server', text: `x.split('\\n')` }], [{
    geste: 'decodage-jsonl', verdict: 'duplique', raison: '…',
    motif: /\.split\((['"`])\\n\1\)/,
    coteServeur: ['lib/server/transcript.js'], coteMoteur: ['netgain/src/core/jsonl.ts'],
  }]);
  assert.equal(r.coherente, false);
  assert.deepEqual(r.gestes[0].sitesInattendus, ['lib/server/nouveau.js']);
});

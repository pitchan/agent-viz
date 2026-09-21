import { expect, test } from 'vitest';
import { verifyMatrix } from '../../docs/audit/scripts/d7-boundary.ts';
import type { SourceFile } from '../../docs/audit/scripts/lib/source-files.ts';

const FILES: SourceFile[] = [
  { path: 'lib/server/transcript.js', zone: 'server', text: `const lines = content.split('\\n');` },
  { path: 'netgain/src/core/jsonl.ts', zone: 'engine', text: `const lines = text.split('\\n');` },
];

test('contrôle positif : une matrice exacte est déclarée cohérente', () => {
  const r = verifyMatrix(FILES, [{
    geste: 'decodage-jsonl', verdict: 'duplique', raison: 'même découpage des deux côtés',
    motif: /\.split\((['"`])\\n\1\)/,
    coteServeur: ['lib/server/transcript.js'], coteMoteur: ['netgain/src/core/jsonl.ts'],
  }]);
  expect(r.coherente).toBe(true);
  expect(r.gestes[0]!.sitesManquants).toEqual([]);
  expect(r.gestes[0]!.sitesInattendus).toEqual([]);
});

test('contrôle négatif : un site déclaré qui n’existe plus fait ÉCHOUER la vérification', () => {
  const r = verifyMatrix(FILES, [{
    geste: 'decodage-jsonl', verdict: 'duplique', raison: '…',
    motif: /\.split\((['"`])\\n\1\)/,
    coteServeur: ['lib/server/disparu.js'], coteMoteur: ['netgain/src/core/jsonl.ts'],
  }]);
  expect(r.coherente).toBe(false);
  expect(r.gestes[0]!.sitesManquants).toEqual(['lib/server/disparu.js']);
});

test('contrôle négatif : un site NON DÉCLARÉ qui correspond au motif est signalé', () => {
  const r = verifyMatrix([...FILES, { path: 'lib/server/nouveau.js', zone: 'server', text: `x.split('\\n')` }], [{
    geste: 'decodage-jsonl', verdict: 'duplique', raison: '…',
    motif: /\.split\((['"`])\\n\1\)/,
    coteServeur: ['lib/server/transcript.js'], coteMoteur: ['netgain/src/core/jsonl.ts'],
  }]);
  expect(r.coherente).toBe(false);
  expect(r.gestes[0]!.sitesInattendus).toEqual(['lib/server/nouveau.js']);
});

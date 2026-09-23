// La ventilation des lectures Read dans le rendu terminal.
import { expect, test } from 'vitest';
import { renderReadsLine } from '../../src/engine/doctor/report/terminal.ts';

const n = (x: number): string => x.toLocaleString('fr-FR');

test('affiche le total puis chaque case non vide avec sa part des octets', () => {
  const s = renderReadsLine({
    totalResults: 100,
    totalBytes: 1000000,
    cases: {
      firstRead: { count: 60, bytes: 600000 },
      identicalReread: { count: 25, bytes: 250000 },
      modifiedReread: { count: 10, bytes: 100000 },
      crossAgentDuplicate: { count: 4, bytes: 40000 },
      error: { count: 1, bytes: 10000 },
    },
  });
  expect(s).not.toBeNull();
  expect(s).toContain('Read ×100');
  expect(s).toContain('relectures identiques ×25');
  expect(s).toContain('25 %');
  expect(s).toContain('après modification ×10');
  expect(s).toContain('doublons inter-agents ×4');
  expect(s).toContain('erreurs ×1');
});

test('les cases vides ne s’affichent pas ; aucun Read → null', () => {
  const zero = { count: 0, bytes: 0 };
  const s = renderReadsLine({
    totalResults: 3,
    totalBytes: 9000,
    cases: { firstRead: { count: 3, bytes: 9000 }, identicalReread: zero, modifiedReread: zero, crossAgentDuplicate: zero, error: zero },
  });
  expect(s).not.toContain('doublons');
  expect(s).not.toContain('erreurs');
  expect(
    renderReadsLine({ totalResults: 0, totalBytes: 0, cases: { firstRead: zero, identicalReread: zero, modifiedReread: zero, crossAgentDuplicate: zero, error: zero } }),
  ).toBeNull();
});

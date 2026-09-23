// La rentabilité du cache 1 h, rendue comme un contrefactuel étiqueté comme tel.
import { expect, test } from 'vitest';
import { renderCounterfactual1h } from '../../src/engine/doctor/report/terminal.ts';

const n = (x: number): string => x.toLocaleString('fr-FR');

test('R petit devant W → pas rentable, les deux nombres affichés', () => {
  // R = 100 000 (récupérable), écritures 5 min = 500 000 → W = 400 000 ; gain 115 000 < coût 300 000.
  const s = renderCounterfactual1h({ recoverableTokens: 100000, tokens5m: 500000 });
  expect(s).not.toBeNull();
  expect(s).toContain(`gain ${n(115000)} tk`);
  expect(s).toContain(`coût ${n(300000)} tk`);
  expect(s).toContain('pas rentable');
  expect(s).toContain('premier ordre');
});

test('R dominant → rentable', () => {
  // R = 400 000, écritures 5 min = 500 000 → W = 100 000 ; gain 460 000 > coût 75 000.
  const s = renderCounterfactual1h({ recoverableTokens: 400000, tokens5m: 500000 });
  expect(s).toContain('→ rentable');
  expect(s).not.toContain('pas rentable');
});

test('aucune écriture 5 min ni expiration récupérable → null', () => {
  expect(renderCounterfactual1h({ recoverableTokens: 0, tokens5m: 0 })).toBeNull();
});

import { expect, test } from 'vitest';

import { renderChurnCauses } from '../../src/engine/doctor/report/terminal.ts';

const n = (x: number): string => x.toLocaleString('fr-FR');

test('n’affiche que les cases non vides, en français, dans un ordre fixe', () => {
  const s = renderChurnCauses({
    growth: { events: 2, tokens: 60000 },
    compaction: { events: 0, tokens: 0 },
    expiration: { events: 1, tokens: 50000 },
    prefixChange: { events: 0, tokens: 0 },
    unknown: { events: 0, tokens: 0 },
  });
  expect(s).not.toBeNull();
  expect(s).toContain(`pause > durée de vie du cache ×1 (${n(50000)} tk)`);
  expect(s).toContain(`fausse alerte (simple croissance) ×2 (${n(60000)} tk)`);
  expect(s).not.toContain('compactage');
  expect(s).not.toContain('indéterminé');
  // L'expiration (actionnable) s'affiche avant la fausse alerte.
  expect(s!.indexOf('pause')).toBeLessThan(s!.indexOf('fausse alerte'));
});

test('tout à zéro → null (pas de ligne)', () => {
  const zero = { events: 0, tokens: 0 };
  expect(
    renderChurnCauses({ growth: zero, compaction: zero, expiration: zero, prefixChange: zero, unknown: zero }),
  ).toBeNull();
});

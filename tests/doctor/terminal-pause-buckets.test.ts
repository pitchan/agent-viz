// La ligne « pauses » rangée sous les causes, dans le rendu terminal.
import { expect, test } from 'vitest';
import { emptyPauseBuckets } from '../../src/engine/doctor/aggregators/context.ts';
import { renderPauseBuckets } from '../../src/engine/doctor/report/terminal.ts';

const n = (x: number): string => x.toLocaleString('fr-FR');

test('affiche les tranches non vides, groupées par durée de vie en vigueur', () => {
  const buckets = emptyPauseBuckets();
  buckets.ttl5m.b5to15m = { events: 3, tokens: 120000 };
  buckets.ttl5m.bOver3h = { events: 1, tokens: 50000 };
  buckets.ttl1h.b1to3h = { events: 2, tokens: 70000 };
  const s = renderPauseBuckets(buckets);
  expect(s).not.toBeNull();
  expect(s).toContain('pauses');
  expect(s).toContain(`5–15 min ×3 (${n(120000)} tk)`);
  expect(s).toContain(`> 3 h ×1 (${n(50000)} tk)`);
  expect(s).toContain('durée de vie 5 min');
  expect(s).toContain('durée de vie 1 h');
  expect(s).toContain(`1–3 h ×2 (${n(70000)} tk)`);
  expect(s).not.toContain('15–60 min');
});

test('tout à zéro → null', () => {
  expect(renderPauseBuckets(emptyPauseBuckets())).toBeNull();
});

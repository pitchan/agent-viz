// La migration de l'hôte vers le cache 1 h, telle que le rendu la montre mois par mois.
import { expect, test } from 'vitest';
import { renderCacheWritesByMonth } from '../../src/engine/doctor/report/terminal.ts';

const n = (x: number): string => x.toLocaleString('fr-FR');

test('agrège par mois et affiche la part du 1 h', () => {
  const s = renderCacheWritesByMonth([
    { startedAt: '2026-06-03T08:00:00.000Z', cacheWrites: { tokens5m: 100000, tokens1h: 0, tokensUnknown: 0 } },
    { startedAt: '2026-07-01T09:00:00.000Z', cacheWrites: { tokens5m: 50000, tokens1h: 50000, tokensUnknown: 0 } },
    { startedAt: '2026-07-12T09:00:00.000Z', cacheWrites: { tokens5m: 0, tokens1h: 100000, tokensUnknown: 0 } },
  ]);
  expect(s).not.toBeNull();
  expect(s).toContain('2026-06 → 1 h 0 %');
  expect(s).toContain('2026-07 → 1 h 75 %');
});

test('les écritures sans détail de durée de vie sont affichées à part, jamais devinées', () => {
  const s = renderCacheWritesByMonth([
    { startedAt: '2026-07-01T09:00:00.000Z', cacheWrites: { tokens5m: 10000, tokens1h: 0, tokensUnknown: 7000 } },
  ]);
  expect(s).toContain(`détail absent : ${n(7000)} tk`);
});

test('aucune écriture → null', () => {
  expect(renderCacheWritesByMonth([{ startedAt: null, cacheWrites: { tokens5m: 0, tokens1h: 0, tokensUnknown: 0 } }])).toBeNull();
});

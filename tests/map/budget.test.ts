import { describe, expect, test } from 'vitest';
import { budgetSlice } from '../../src/engine/map/budget.js';

const mkItems = (n: number): Array<{ path: string; note: string }> =>
  Array.from({ length: n }, (_, i) => ({ path: `/api/resource-${i}/very/long/segment/${i}`, note: 'x'.repeat(40) }));

describe('budgetSlice — budget de réponse', () => {
  test('petite liste : tout passe, rien d\'omis, pas de note', () => {
    const items = mkItems(3);
    const slice = budgetSlice(items, {});
    expect(slice.items).toEqual(items);
    expect(slice.total).toBe(3);
    expect(slice.omitted).toBe(0);
    expect(slice.note).toBeUndefined();
  });

  test('grande liste : sérialisation ≤ 2048 octets par défaut, coupe TOUJOURS annotée +N omitted', () => {
    const slice = budgetSlice(mkItems(200), {});
    expect(slice.omitted).toBeGreaterThan(0);
    expect(slice.note).toBe(`+${slice.omitted} omitted`);
    expect(slice.total).toBe(200);
    expect(Buffer.byteLength(JSON.stringify(slice), 'utf8')).toBeLessThanOrEqual(2048);
    expect(slice.items.length + slice.omitted).toBe(200);
  });

  test('offset pagine : la page suivante commence où la coupe a eu lieu', () => {
    const items = mkItems(200);
    const page1 = budgetSlice(items, {});
    const page2 = budgetSlice(items, { offset: page1.items.length });
    expect(page2.items[0]).toEqual(items[page1.items.length]);
    expect(page2.items.length + page2.omitted + page1.items.length).toBe(200);
  });

  test('limit explicite plus petit que le budget est respecté', () => {
    const slice = budgetSlice(mkItems(50), { limit: 5 });
    expect(slice.items).toHaveLength(5);
    expect(slice.omitted).toBe(45);
    expect(slice.note).toBe('+45 omitted');
  });
});

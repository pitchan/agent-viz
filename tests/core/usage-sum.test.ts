// sumUsageInto fusionne deux seaux de comptes sans en perdre un champ.
import { expect, test } from 'vitest';
import { addUsage, emptyUsageBucket, sumUsageInto } from '../../src/engine/core/usage.ts';

test('additionne les six champs, et ne touche pas la source', () => {
  const cible = emptyUsageBucket();
  const src = emptyUsageBucket();
  addUsage(src, {
    input_tokens: 1, output_tokens: 2,
    cache_creation_input_tokens: 3, cache_read_input_tokens: 4,
    cache_creation: { ephemeral_1h_input_tokens: 5, ephemeral_5m_input_tokens: 6 },
  });
  sumUsageInto(cible, src);
  sumUsageInto(cible, src);
  expect(cible).toEqual({ in: 2, out: 4, cacheCreate: 6, cacheRead: 8, cacheCreate1h: 10, cacheCreate5m: 12 });
  expect(src.in).toBe(1);
});

// Une compaction porte ce qui l'a déclenchée et le volume qu'elle a trouvé devant elle.
import { expect, test } from 'vitest';
import { ContextAggregator } from '../../src/engine/doctor/aggregators/context.ts';

test('collecte trigger et preTokens', () => {
  const agg = new ContextAggregator();
  agg.addCompact({ kind: 'compact', trigger: 'auto', preTokens: 365785 }, 'main');
  agg.addCompact({ kind: 'compact', trigger: 'manual', preTokens: null }, 'main');
  expect(agg.result().compactions).toEqual([
    { trigger: 'auto', preTokens: 365785 },
    { trigger: 'manual', preTokens: null },
  ]);
});

// Les écritures de cache ventilées 5 min / 1 h / indéterminé, selon le détail que le
// journal porte réellement.
import { expect, test } from 'vitest';
import { ContextAggregator } from '../../src/engine/doctor/aggregators/context.ts';
import { assistant } from '../helpers/context-events.ts';

test('ventile 5 min / 1 h / indéterminé selon le détail présent dans le journal', () => {
  const agg = new ContextAggregator();
  agg.addAssistant(
    assistant('m1', {
      cache_creation_input_tokens: 50000,
      output_tokens: 1,
      cache_creation: { ephemeral_5m_input_tokens: 30000, ephemeral_1h_input_tokens: 20000 },
    }),
    'main',
  );
  agg.addAssistant(assistant('m2', { cache_creation_input_tokens: 10000, output_tokens: 1 }), 'main'); // pas de détail → indéterminé
  agg.addAssistant(
    assistant('m3', { cache_creation_input_tokens: 5000, output_tokens: 1, cache_creation: { ephemeral_5m_input_tokens: 3000 } }),
    'main',
  ); // reste non couvert par le détail → indéterminé
  expect(agg.result().cacheWrites).toEqual({ tokens5m: 33000, tokens1h: 20000, tokensUnknown: 12000 });
});

test('dédup par msgId : la même ligne répétée ne compte pas double', () => {
  const agg = new ContextAggregator();
  const evt = assistant('m1', { cache_creation_input_tokens: 40000, output_tokens: 1, cache_creation: { ephemeral_5m_input_tokens: 40000 } });
  agg.addAssistant(evt, 'main');
  agg.addAssistant(evt, 'main');
  expect(agg.result().cacheWrites).toEqual({ tokens5m: 40000, tokens1h: 0, tokensUnknown: 0 });
});

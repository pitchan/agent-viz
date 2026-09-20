// service.purge empties the store and does nothing else: the engine is built
// when its module loads, so no engine check stands before the wipe.

import { expect, test } from 'vitest';
import { createObservatoryService } from '../../src/server/observatory/service.ts';

type ServiceDeps = Parameters<typeof createObservatoryService>[0];

test('purge empties the store', async () => {
  let purged = false;
  const service = createObservatoryService({
    store: { purge: () => { purged = true; } },
  } as unknown as ServiceDeps);
  await service.purge();
  expect(purged).toBe(true);
});

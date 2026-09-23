// extractLineMeta lit ce qu'une ligne de transcript porte AVANT toute normalisation.
import { expect, test } from 'vitest';
import { extractLineMeta } from '../../src/engine/core/events.ts';

test('remonte cwd, version, gitBranch quand présents', () => {
  expect(
    extractLineMeta({ type: 'user', cwd: 'F:\\proj', version: '2.1.201', gitBranch: 'main', message: {} }),
  ).toEqual({ cwd: 'F:\\proj', version: '2.1.201', gitBranch: 'main' });
  expect(extractLineMeta({ type: 'assistant' })).toEqual({});
  expect(extractLineMeta('junk')).toEqual({});
});

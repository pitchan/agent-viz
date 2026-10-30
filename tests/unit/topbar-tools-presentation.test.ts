// Le segment des échecs à côté du compteur « tools » de l'en-tête.
import { expect, test } from 'vitest';
import { toolsPresentation } from '../../src/web/viz-topbar-status.ts';

test('sans échec, le segment se tait', () => expect(toolsPresentation(0)).toEqual({ failedText: null }));

test('avec des échecs, le segment les compte en anglais comme le reste de l en-tête', () => expect(toolsPresentation(3)).toEqual({ failedText: '3 failed' }));

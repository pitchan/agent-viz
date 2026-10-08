// La cellule « Prompt long » du tableau des tarifs : le second tarif d'un modèle tarifé par
// longueur de prompt, un tiret pour un modèle au prix unique.
import { expect, test } from 'vitest';
import { longPromptRatesCell } from '../../src/web/observatory/format.ts';

test('un modèle tarifé par longueur de prompt affiche son seuil et son second tarif', () => {
  expect(longPromptRatesCell({ above: 100_000, prices: { input: 5e-7, output: 2.5e-6 } }))
    .toBe('au-delà de 100k jetons de prompt : 0,50 $ le million entrée / 2,50 $ le million sortie');
});

test('un modèle au prix unique affiche un tiret', () => {
  expect(longPromptRatesCell(null)).toBe('—');
});

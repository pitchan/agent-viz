// Le mode rapide ne s'affiche que s'il a servi : une cellule vide se lit « — »,
// jamais « 0,00 $ ».
import { expect, test } from 'vitest';
import { fastCostCell, fastTotalNote, fastRatesCell } from '../../src/web/observatory/format.ts';

test('cellule du coût rapide : le montant quand le mode rapide a servi', () => {
  expect(fastCostCell(2)).toBe('2,00 $');
});

test('cellule du coût rapide : un tiret sans mode rapide', () => {
  expect(fastCostCell(0)).toBe('—');
});

test('mention du résumé : le montant rapide quand il a servi', () => {
  expect(fastTotalNote(2)).toBe(' dont 2,00 $ en mode rapide');
});

test('mention du résumé : rien sans mode rapide', () => {
  expect(fastTotalNote(0)).toBe('');
});

test('tarif rapide du barème : entrée et sortie par million', () => {
  expect(fastRatesCell({ input: 8e-6, output: 4e-5 })).toBe('8,00 $ le million entrée / 40,00 $ le million sortie');
});

test('tarif rapide du barème : un tiret pour un modèle sans mode rapide', () => {
  expect(fastRatesCell(null)).toBe('—');
});

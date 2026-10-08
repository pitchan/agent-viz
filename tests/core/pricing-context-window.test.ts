// La fenêtre de contexte de chaque modèle de la table : le plafond que la jauge de contexte
// affiche. Écrite en littéral : lue de la table, elle ne rougirait pas quand une fenêtre y change.
import { expect, test } from 'vitest';
import { priceTable } from '../../src/engine/core/pricing.ts';

const FENETRES: Record<string, number> = {
  'claude-fable-5': 1_000_000,
  'claude-fable-5-1': 1_000_000,
  'claude-mythos-5': 1_000_000,
  'claude-mythos-5-1': 1_000_000,
  'claude-opus-5-5': 1_000_000,
  'claude-opus-5': 1_000_000,
  'claude-sonnet-5': 1_000_000,
  'claude-opus-4-8': 1_000_000,
  'claude-opus-4-7': 1_000_000,
  'claude-opus-4-6': 1_000_000,
  'claude-opus-4-5': 200_000,
  'claude-sonnet-4-6': 1_000_000,
  'claude-sonnet-4-5': 200_000,
  'claude-haiku-4-5': 200_000,
  'claude-haiku-5-5': 1_000_000,
  'gpt-6-astra': 258_400,
  'gpt-6.1-sol': 258_400,
  'gpt-5.6-sol': 258_400,
  'gpt-5.6-terra': 258_400,
  'gpt-5.6-luna': 258_400,
};

const MODELES = Object.entries(FENETRES).map(([modele, fenetre]) => ({ modele, fenetre }));

test.each(MODELES)('$modele : la fenêtre de contexte est de $fenetre jetons', ({ modele, fenetre }) => {
  expect(priceTable().entries.find((e) => e.model === modele)?.maxInput).toBe(fenetre);
});

test('chaque modèle de la table a sa fenêtre vérifiée ici', () => {
  expect(priceTable().entries.map((e) => e.model).sort()).toEqual(Object.keys(FENETRES).sort());
});

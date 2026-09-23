// isNoisePrompt écarte le bruit injecté dans le transcript : ce n'est pas un prompt humain.
import { expect, test } from 'vitest';
import { isNoisePrompt } from '../../src/engine/doctor/aggregators/prompts.ts';

test('contenu XML injecté par le harnais exclu', () => {
  expect(isNoisePrompt('<command-name>/bench</command-name>')).toBe(true);
  expect(isNoisePrompt('<local-command-stdout>...</local-command-stdout>')).toBe(true);
  expect(isNoisePrompt('<ide_selection>lignes 1-3</ide_selection>')).toBe(true);
  expect(isNoisePrompt('<system-reminder>rappel</system-reminder>')).toBe(true);
  expect(isNoisePrompt('   ')).toBe(true);
});

test('vrai prompt humain conservé', () => {
  expect(isNoisePrompt('Analyse le document 09 et dis-moi ce que tu en penses')).toBe(false);
});
